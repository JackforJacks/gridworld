// Three.js/scene/tile helpers
const Hexasphere = require('./Sphere/hexaSphere');

function createScene(
    radius,               // e.g., 30, the radius of the sphere
    subdivisions,         // e.g., 10, how many times to subdivide the icosahedron
    tileWidthRatio,       // e.g., 1 (for no padding between tiles, 0.9 for some padding)
    scene,                // THREE.Scene instance
    world,                // No longer used (was ECSY World instance)
    currentTiles,         // Array to store created THREE.Mesh objects for tiles
    terrainColors,        // Object mapping terrain types to color codes (e.g., {ocean: 0x0066cc, grassland: 0x66cc66})
    isLand,               // Function(centerPoint) => boolean, determines if a tile is land or water
    TileComponent,        // No longer used (was ECSY Component class for tiles)
    backgroundSphere,     // Optional: the visual background sphere mesh (assumed to be already in scene)
    hexasphere_global,    // This is window.hexasphere, it will be reassigned with the new Hexasphere instance
    renderer, camera, tilePopup, borderLines, selectedTile, borderLineMaterial, // Other THREE.js and UI elements
    mousePosition, raycaster, rotation, targetRotation, autoRotate, isDragging, previousMousePosition,
    initialMouseDownPosition, clickStartTime, clickTolerance, cameraDistance, minCameraDistance, maxCameraDistance,
    updateDashboardCallback // No longer used (was callback function to update dashboard elements)
) {
    // 1. Clear existing tile meshes from the scene and the currentTiles array
    if (currentTiles && currentTiles.length > 0) {
        currentTiles.forEach(tileMesh => scene.remove(tileMesh));
        currentTiles.length = 0; // Reset the array
    }    // 2. Create a new Hexasphere instance (from the Hexasphere.js library)
    // Assign it to window.hexasphere so it's globally accessible if needed.
    window.hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);

    let generatedTileDataForReturn = []; // To store data for the return value

    // 3. Create a single unified geometry for the entire hexasphere
    const hexasphereGeometry = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const indices = [];
    let vertexIndex = 0;    // Store tile data for userData (will be attached to the single mesh)
    // No longer needed - using Tile properties directly

    window.hexasphere.tiles.forEach((tile, idx) => {
        // Calculate terrain type and coordinates
        let lat = 0, lon = 0;
        try {
            if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
                const latLonRad = tile.centerPoint.getLatLon();
                lat = latLonRad.lat * 180 / Math.PI;
                lon = latLonRad.lon * 180 / Math.PI;
            } else {
                const r = Math.sqrt(tile.centerPoint.x * tile.centerPoint.x + tile.centerPoint.y * tile.centerPoint.y + tile.centerPoint.z * tile.centerPoint.z);
                lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
                lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
            }
        } catch (e) {
            console.warn("Could not get lat/lon from tile.centerPoint for tile ID:", idx, e);
        }

        // Assign terrain type
        let terrainType;
        if (lat >= 89 || lat <= -89) {
            terrainType = 'ice';
        } else {
            terrainType = isLand(tile.centerPoint) ? 'grassland' : 'ocean';
        }

        // Determine if tile is Habitable
        const Habitable = (terrainType === 'ice' || terrainType === 'ocean') ? 'no' : 'yes';

        // Set all properties directly on the tile object - single source of truth!
        tile.setProperties(idx, lat, lon, isLand(tile.centerPoint), terrainType, Habitable);

        const color = new THREE.Color(
            terrainType === 'ice' ? 0xffffff : // white for ice
                terrainType === 'grassland' ? terrainColors.grassland : terrainColors.ocean
        );

        // Fix: define boundaryPoints for this tile
        const boundaryPoints = tile.boundary.map(p => new THREE.Vector3(p.x, p.y, p.z));

        // Simple fan triangulation from the first vertex of the boundary to form faces
        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            // Triangle vertices
            vertices.push(boundaryPoints[0].x, boundaryPoints[0].y, boundaryPoints[0].z);
            vertices.push(boundaryPoints[i].x, boundaryPoints[i].y, boundaryPoints[i].z);
            vertices.push(boundaryPoints[i + 1].x, boundaryPoints[i + 1].y, boundaryPoints[i + 1].z);

            // Colors for each vertex (same color for the entire triangle)
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);

            // Indices for the triangle            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            vertexIndex += 3;
        }

        // Prepare data for the function's return value
        generatedTileDataForReturn.push({
            tileId: tile.id,
            latitude: tile.latitude,
            longitude: tile.longitude,
            Habitable: tile.Habitable
        });

        // ECSY integration removed - no longer creating entities
    });

    // Create the unified hexasphere geometry
    hexasphereGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    hexasphereGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    hexasphereGeometry.setIndex(indices);
    hexasphereGeometry.computeVertexNormals();

    // Create material that uses vertex colors
    const hexasphereMaterial = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.DoubleSide
    });    // Create the single hexasphere mesh
    const hexasphereMesh = new THREE.Mesh(hexasphereGeometry, hexasphereMaterial);

    // Store hexasphere reference in userData - no separate tile data needed
    hexasphereMesh.userData = {
        hexasphere: window.hexasphere
    };

    // Add to scene and current tiles array
    scene.add(hexasphereMesh);
    currentTiles.push(hexasphereMesh);

    // Store reference to the mesh in the hexasphere object for rotation in tick()
    window.hexasphere.mesh = hexasphereMesh;

    // 4. Ensure basic lighting is present in the scene for MeshPhongMaterial to look good
    if (!scene.getObjectByName("ambientLight")) {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Ambient light to illuminate all objects
        ambientLight.name = "ambientLight";
        scene.add(ambientLight);
    }
    if (!scene.getObjectByName("directionalLight")) {
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7); // Directional light for highlights and shadows
        directionalLight.position.set(5, 10, 7.5).normalize(); // Set light position
        directionalLight.name = "directionalLight";
        scene.add(directionalLight);
    }    // 5. Call the dashboard update function if it was provided
    if (typeof updateDashboardCallback === 'function') {
        updateDashboardCallback(window.hexasphere);
    }

    // 6. Return the array of tile data (id, lat, lon).
    // This format is consistent with what init.js might expect if it needs to post newly generated data to a server.
    return generatedTileDataForReturn;
}

function tick(lastTime, autoRotate, targetRotation, rotation, camera, scene, renderer, cameraDistance, updateCallback) {
    const time = Date.now();
    const delta = time - lastTime; if (autoRotate) {
        targetRotation.y += 0.001; // Slower, more natural rotation speed like Earth
    }

    rotation.x += (targetRotation.x - rotation.x) * 0.1;
    rotation.y += (targetRotation.y - rotation.y) * 0.1;

    // Debug log rotation every 2 seconds    // For proper vertical axis rotation like Earth:
    // - Y rotation (horizontal mouse movement) should rotate around the vertical Y-axis
    // - X rotation (vertical mouse movement) should change the camera's elevation angle
    // - The sphere itself should only rotate around its Y-axis for auto-rotation
    // Apply sphere auto-rotation only around Y-axis (vertical axis)
    if (window.hexasphere && window.hexasphere.mesh) {
        if (autoRotate) {
            // Auto-rotate the sphere around its own Y-axis (like Earth)
            window.hexasphere.mesh.rotation.y = rotation.y;
        } else {
            // When manually controlling, keep sphere orientation fixed and move camera
            window.hexasphere.mesh.rotation.y = 0;
        }
        window.hexasphere.mesh.rotation.x = 0;
        window.hexasphere.mesh.rotation.z = 0;
    }

    // Position camera using proper spherical coordinates for vertical axis
    // rotation.y = horizontal rotation around Y-axis (azimuth)
    // rotation.x = vertical angle (elevation/inclination)
    camera.position.x = cameraDistance * Math.sin(rotation.y) * Math.cos(rotation.x);
    camera.position.y = cameraDistance * Math.sin(rotation.x); // Y is vertical
    camera.position.z = cameraDistance * Math.cos(rotation.y) * Math.cos(rotation.x);
    camera.lookAt(scene.position); // Ensure camera is looking at the origin (0,0,0) where the scene content is.

    renderer.render(scene, camera);

    if (typeof updateCallback === 'function') {
        updateCallback(time, rotation, targetRotation);
    }

    // ECSY world execution is typically handled by its own loop, often via world.execute().
    // It's separated from the render loop in this project's structure (see startGame in startstop.js).
    // if (world) {
    //     world.execute(delta / 1000, time / 1000);
    // }
}

function onWindowResize(camera, renderer) {
    const width = window.innerWidth;
    const height = window.innerHeight - 10;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

module.exports = {
    createScene,
    tick,
    onWindowResize
};
