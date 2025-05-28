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
    let vertexIndex = 0;

    // Store tile data for userData (will be attached to the single mesh)
    const tileData = {};

    window.hexasphere.tiles.forEach((tile, idx) => {
        // Assign a unique numerical id if not present
        tile.id = idx;
        // --- Determine if this tile is a pole (north or south) ---
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
            console.warn("Could not get lat/lon from tile.centerPoint for tile ID:", tile.id, e);
        }

        // --- Assign terrain type ---
        let terrainType;
        // Within 1 degree of the poles
        if (lat >= 89 || lat <= -89) {
            terrainType = 'ice';
        } else {
            terrainType = isLand(tile.centerPoint) ? 'grassland' : 'ocean';
        }
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

            // Indices for the triangle
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            vertexIndex += 3;
        }        // Populate tile data for later use (e.g., displaying info in popups)
        lat = 0, lon = 0;

        try {
            // tile.centerPoint is a Point object from Hexasphere.js, which should have a getLatLon method
            if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
                const latLonRad = tile.centerPoint.getLatLon(); // Returns {lat, lon} in radians
                lat = latLonRad.lat * 180 / Math.PI; // Convert latitude to degrees
                lon = latLonRad.lon * 180 / Math.PI; // Convert longitude to degrees
            } else {
                // Fallback: estimate lat/lon from vector coordinates
                const r = Math.sqrt(tile.centerPoint.x * tile.centerPoint.x + tile.centerPoint.y * tile.centerPoint.y + tile.centerPoint.z * tile.centerPoint.z);
                lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
                lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
            }
        } catch (e) {
            console.warn("Could not get lat/lon from tile.centerPoint for tile ID:", tile.id, e);
        }        // Store tile data
        tileData[tile.id] = {
            id: tile.id,
            tileObject: tile,
            latitude: lat,
            longitude: lon,
            isLand: isLand(tile.centerPoint),
            terrainType: terrainType // add terrain type for reference
        };        // Prepare data for the function's return value
        generatedTileDataForReturn.push({
            tileId: tile.id,
            latitude: lat,
            longitude: lon
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
    });

    // Create the single hexasphere mesh
    const hexasphereMesh = new THREE.Mesh(hexasphereGeometry, hexasphereMaterial);
    
    // Store all tile data in the mesh's userData
    hexasphereMesh.userData = {
        tiles: tileData,
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
    const delta = time - lastTime;    if (autoRotate) {
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

function onMouseWheel(event, cameraDistance, minCameraDistance, maxCameraDistance, updateCallback) {
    event.preventDefault();
    
    // Adjust zoom speed based on current distance for smoother zooming
    const zoomSpeed = Math.max(0.5, cameraDistance * 0.02);
    
    if (event.deltaY > 0) {
        // Zoom out
        cameraDistance = Math.min(maxCameraDistance, cameraDistance + zoomSpeed);
    } else {
        // Zoom in
        cameraDistance = Math.max(minCameraDistance, cameraDistance - zoomSpeed);
    }
    
    updateCallback(cameraDistance);
    return cameraDistance;
}

function onMouseDown(event, isDragging, autoRotate, clickStartTime, previousMousePosition, initialMouseDownPosition, mousePosition, renderer, updateCallback) {
    event.preventDefault();
      
    isDragging = true;
    autoRotate = false; // Stop auto-rotation when user starts dragging
    clickStartTime = Date.now();
    
    // Use client coordinates directly for consistency
    previousMousePosition.x = event.clientX;
    previousMousePosition.y = event.clientY;
    initialMouseDownPosition.x = event.clientX;
    initialMouseDownPosition.y = event.clientY;
    
    // Calculate normalized coordinates for raycasting
    const rect = renderer.domElement.getBoundingClientRect();
    mousePosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mousePosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      updateCallback(isDragging, autoRotate, clickStartTime, previousMousePosition, initialMouseDownPosition, mousePosition);
}

function onMouseMove(event, isDragging, targetRotation, previousMousePosition, tilePopup, updateCallback) {    
    if (!isDragging) return;
    
    event.preventDefault();
    
    // Use consistent coordinate calculation with onMouseDown
    const currentMouseX = event.clientX;
    const currentMouseY = event.clientY;
    
    const deltaX = currentMouseX - previousMousePosition.x;
    const deltaY = currentMouseY - previousMousePosition.y;
        // Adjust rotation sensitivity for smoother movement
    const rotationSpeed = 0.005; // Reduced for smoother movement
    
    // Update target rotation based on mouse movement
    // Horizontal movement rotates around Y axis, vertical movement around X axis
    targetRotation.y += deltaX * rotationSpeed;
    targetRotation.x -= deltaY * rotationSpeed; // Inverted for natural feel
      // Clamp vertical rotation to prevent flipping
    targetRotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, targetRotation.x));
      // Update previous mouse position for next frame
    previousMousePosition.x = currentMouseX;
    previousMousePosition.y = currentMouseY;
    
    // Hide tile popup while dragging
    if (tilePopup) {
        tilePopup.style.display = 'none';
    }
      updateCallback(targetRotation, previousMousePosition);
}

function onMouseUp(event, isDragging, autoRotate, clickStartTime, initialMouseDownPosition, rotation, targetRotation, currentTiles, scene, camera, raycaster, selectedTile, borderLines, borderLineMaterial, tilePopup, hexasphere, updateCallback) {
    if (!isDragging) return;
    
    event.preventDefault();
    
    const clickDuration = Date.now() - clickStartTime;
    const clickDistance = Math.sqrt(
        Math.pow(event.clientX - initialMouseDownPosition.x, 2) + 
        Math.pow(event.clientY - initialMouseDownPosition.y, 2)
    );
    
    // If it was a quick click with minimal movement, treat it as a tile selection
    if (clickDuration < 200 && clickDistance < 5) {
        checkTileIntersection(event, currentTiles, scene, camera, raycaster, selectedTile, borderLines, borderLineMaterial, tilePopup, (newSelectedTile, newBorderLines) => {
            selectedTile = newSelectedTile;
            borderLines = newBorderLines;
        });
    }
    
    isDragging = false;
    // Optionally re-enable auto-rotation after a delay
    // setTimeout(() => { autoRotate = true; }, 3000);
    
    updateCallback(isDragging, autoRotate, targetRotation.x, targetRotation.y, selectedTile, borderLines);
}

function checkTileIntersection(event, currentTiles, scene, camera, raycaster, selectedTile, borderLines, borderLineMaterial, tilePopup, updateCallback) {
    // Get mouse position relative to the renderer canvas
    const rect = event.target.getBoundingClientRect();
    const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Update raycaster
    raycaster.setFromCamera({ x: mouseX, y: mouseY }, camera);
    
    // Check for intersections with the hexasphere mesh
    const intersects = raycaster.intersectObjects(currentTiles);
    
    if (intersects.length > 0) {
        const intersectedMesh = intersects[0].object;
        const intersectionPoint = intersects[0].point;
        
        // Find the closest tile to the intersection point
        let closestTile = null;
        let minDistance = Infinity;
        
        if (window.hexasphere && window.hexasphere.tiles) {
            window.hexasphere.tiles.forEach(tile => {
                const tileCenter = new THREE.Vector3(tile.centerPoint.x, tile.centerPoint.y, tile.centerPoint.z);
                const distance = intersectionPoint.distanceTo(tileCenter);
                
                if (distance < minDistance) {
                    minDistance = distance;
                    closestTile = tile;
                }
            });
        }
          if (closestTile) {
            // Check if clicking the same tile again - if so, deselect it
            if (selectedTile && selectedTile.id === closestTile.id) {
                // Same tile clicked again - remove border and deselect
                if (borderLines) {
                    scene.remove(borderLines);
                    borderLines = null;
                }
                if (tilePopup) {
                    tilePopup.style.display = 'none';
                }
                selectedTile = null;
            } else {
                // Different tile clicked - remove previous border and create new one
                if (borderLines) {
                    scene.remove(borderLines);
                }                // Create border for selected tile with enhanced visibility
                const borderGroup = new THREE.Group();
                
                // Create multiple thin lines offset slightly to simulate thickness
                for (let offset = 0; offset < 3; offset++) {
                    const borderGeometry = new THREE.BufferGeometry();
                    const borderVertices = [];
                    const offsetScale = offset * 0.01; // Small offset for thickness effect
                    
                    // Create lines around the tile boundary with validation
                    for (let i = 0; i < closestTile.boundary.length; i++) {
                        const current = closestTile.boundary[i];
                        const next = closestTile.boundary[(i + 1) % closestTile.boundary.length];
                        
                        // Validate coordinates before adding
                        if (current && next && 
                            !isNaN(current.x) && !isNaN(current.y) && !isNaN(current.z) &&
                            !isNaN(next.x) && !isNaN(next.y) && !isNaN(next.z)) {
                            
                            // Apply small offset to create thickness effect
                            const currentVec = new THREE.Vector3(current.x, current.y, current.z);
                            const nextVec = new THREE.Vector3(next.x, next.y, next.z);
                            
                            // Normalize and apply offset
                            currentVec.normalize().multiplyScalar(30 + offsetScale);
                            nextVec.normalize().multiplyScalar(30 + offsetScale);
                            
                            borderVertices.push(currentVec.x, currentVec.y, currentVec.z);
                            borderVertices.push(nextVec.x, nextVec.y, nextVec.z);
                        }
                    }
                    
                    if (borderVertices.length > 0) {
                        borderGeometry.setAttribute('position', new THREE.Float32BufferAttribute(borderVertices, 3));
                        
                        // Create bright red border material
                        const borderMaterial = new THREE.LineBasicMaterial({
                            color: 0xff0000,
                            depthTest: false,
                            transparent: true,
                            opacity: 0.8 - (offset * 0.1) // Slight fade for overlapping lines
                        });
                        
                        const borderLine = new THREE.LineSegments(borderGeometry, borderMaterial);
                        borderGroup.add(borderLine);
                    }
                }
                
                borderLines = borderGroup;
                scene.add(borderLines);
                
                // Show tile popup with information
                if (tilePopup) {
                    // Calculate latitude and longitude for the tile center
                    let lat = 0, lon = 0;
                    try {
                        if (closestTile.centerPoint && typeof closestTile.centerPoint.getLatLon === 'function') {
                            // If getLatLon exists, use it (assume radius 1)
                            const latLon = closestTile.centerPoint.getLatLon(1);
                            lat = latLon.lat;
                            lon = latLon.lon;
                        } else {
                            // Fallback: estimate lat/lon from vector coordinates
                            const r = Math.sqrt(closestTile.centerPoint.x * closestTile.centerPoint.x + closestTile.centerPoint.y * closestTile.centerPoint.y + closestTile.centerPoint.z * closestTile.centerPoint.z);
                            lat = Math.asin(closestTile.centerPoint.y / r) * 180 / Math.PI;
                            lon = Math.atan2(closestTile.centerPoint.z, closestTile.centerPoint.x) * 180 / Math.PI;
                        }
                    } catch (e) {
                        console.warn("Could not get lat/lon from tile.centerPoint for tile ID:", closestTile.id, e);
                    }
                    tilePopup.innerHTML = `
                        <strong>Tile ${closestTile.id}</strong><br>
                        Lat: ${lat.toFixed(4)}°, Lon: ${lon.toFixed(4)}°<br>
                        Boundary points: ${closestTile.boundary.length}
                    `;
                    tilePopup.style.display = 'block';
                    tilePopup.style.left = (event.clientX + 10) + 'px';
                    tilePopup.style.top = (event.clientY + 10) + 'px';
                }
                
                selectedTile = closestTile;
            }
        }
    } else {
        // No intersection, hide popup and remove border
        if (tilePopup) {
            tilePopup.style.display = 'none';
        }
        if (borderLines) {
            scene.remove(borderLines);
            borderLines = null;
        }
        selectedTile = null;
    }
    
    updateCallback(selectedTile, borderLines);
}

module.exports = {
    createScene,
    tick,
    onWindowResize,
    onMouseWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    checkTileIntersection
};
