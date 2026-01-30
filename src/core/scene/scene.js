// Three.js/scene/tile helpers

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
    updateDashboardCallback, // No longer used (was callback function to update dashboard elements)
    tileData // <-- NEW: pass in tile data from server
) {
    // 1. Clear existing tile meshes from the scene and the currentTiles array
    if (currentTiles && currentTiles.length > 0) {
        currentTiles.forEach(tileMesh => scene.remove(tileMesh));
        currentTiles.length = 0; // Reset the array
    }
    // 2. Use provided tileData to build geometry
    if (!tileData) {
        console.error('No tile data provided from server!');
        return;
    }

    // Note: Tile geometry is built by the Hexasphere module and rendered separately.
    // This function's primary role is scene initialization and lighting setup.

    // 3. Ensure basic lighting is present in the scene for MeshPhongMaterial to look good
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
    }
    if (typeof updateDashboardCallback === 'function') {
        updateDashboardCallback(tileData);
    }
    return tileData;
}

function tick(lastTime, autoRotate, targetRotation, rotation, camera, scene, renderer, cameraDistance, updateCallback) {
    const time = Date.now();
    const delta = time - lastTime; if (autoRotate) {
        targetRotation.y += 0.001; // Slower, more natural rotation speed like Earth
    }

    rotation.x += (targetRotation.x - rotation.x) * 0.1;
    rotation.y += (targetRotation.y - rotation.y) * 0.1;

    // Camera and sphere rotation system:
    // - Y rotation (horizontal mouse movement) rotates around the vertical Y-axis
    // - X rotation (vertical mouse movement) changes the camera's elevation angle
    // - The sphere rotates around its Y-axis for auto-rotation (like Earth)
    
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
