// Initialization logic for GridWorld
const { createScene, tick } = require('./scene');
const { terrainColors, isLand, updateDashboard } = require('./utils');

async function initializeAndStartGame() {
    console.log('[init.js] initializeAndStartGame called'); // DEBUG LOG
    console.log('[init.js] window.currentTiles before createScene:', typeof window.currentTiles, Array.isArray(window.currentTiles), window.currentTiles); // DEBUG LOG
    
    if (window.sceneInitialized) {
        console.log("Scene already initialized.");
        return;
    }
    console.log("Initializing scene...");
    try {
        // Wait for projection image to load before proceeding
        const img = document.getElementById("projection");
        if (img && !img.complete) {
            await new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = () => {
                    console.warn("Projection image failed to load, proceeding without it");
                    resolve();
                };
            });
        }
        // Create a background sphere for visual reference
        const backgroundSphere = new THREE.Mesh(
            new THREE.SphereGeometry(28, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0x001122, transparent: true, opacity: 0.3 })
        );
        window.scene.add(backgroundSphere);        // Initial data load and scene creation - No server interaction
        let initialTileData = null; // Always start with no data from server        // Always call createScene as if no server data is available.
        // createScene will generate its own data if null is passed.
        
        // Ensure currentTiles is initialized as an array
        if (!window.currentTiles || !Array.isArray(window.currentTiles)) {
            console.warn('[init.js] window.currentTiles was not properly initialized, creating new array');
            window.currentTiles = [];
        }
          let generatedData = createScene(
            30, // radius
            10, // subdivisions
            1,  // tileWidthRatio
            window.scene,
            null, // world - no longer using ECSY
            window.currentTiles,
            terrainColors,
            isLand,
            null, // TileComponent - no longer using ECSY
            backgroundSphere,
            window.hexasphere, // global hexasphere instance to be (re)created
            window.renderer,
            window.camera,
            window.tilePopup,
            window.borderLines,
            window.selectedTile,
            window.borderLineMaterial,
            window.mousePosition,
            window.raycaster,
            window.rotation,
            window.targetRotation,
            window.autoRotate,
            window.isDragging,
            window.previousMousePosition,
            window.initialMouseDownPosition,
            window.clickStartTime,
            window.clickTolerance,
            window.cameraDistance,
            window.minCameraDistance,            window.maxCameraDistance,
            updateDashboard // Pass the dashboard update function
        );

        // Server data posting removed
        
        window.sceneInitialized = true;
        
        // Update dashboard with the created hexasphere
        if (window.hexasphere) {
            updateDashboard(window.hexasphere);
        }
        
        console.log("Scene initialization complete.");
    } catch (error) {
        console.error("Error during initialization:", error);
    }
}

if (typeof window !== 'undefined') {
  window.initializeAndStartGame = initializeAndStartGame;
}

module.exports = { initializeAndStartGame };
