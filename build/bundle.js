(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// Camera Controller Module
// Handles camera movement, zoom, and rotation logic

class CameraController {
    constructor(camera, initialDistance = 65) {
        this.camera = camera;
        this.distance = initialDistance;
        this.minDistance = 40;
        this.maxDistance = 120;
        
        this.rotation = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.autoRotate = true;
        this.rotationSpeed = 0.005;
        this.autoRotateSpeed = 0.001;
    }

    // Update camera position based on current rotation and distance
    updatePosition() {
        this.camera.position.set(0, 0, this.distance);
        this.camera.lookAt(0, 0, 0);
        
        // Apply rotations
        this.camera.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.rotation.x);
        this.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
        this.camera.lookAt(0, 0, 0);
    }

    // Smooth rotation interpolation
    tick(deltaTime) {
        const lerpFactor = 0.1;
        
        // Auto-rotation
        if (this.autoRotate) {
            this.targetRotation.y += this.autoRotateSpeed * deltaTime;
        }
        
        // Smooth interpolation to target rotation
        this.rotation.x += (this.targetRotation.x - this.rotation.x) * lerpFactor;
        this.rotation.y += (this.targetRotation.y - this.rotation.y) * lerpFactor;
        
        this.updatePosition();
    }

    // Handle mouse drag rotation
    handleMouseDrag(deltaX, deltaY) {
        this.targetRotation.y -= deltaX * this.rotationSpeed;
        this.targetRotation.x += deltaY * this.rotationSpeed;
        this.targetRotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.targetRotation.x));
        this.autoRotate = false;
    }

    // Handle zoom
    zoom(delta) {
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance + delta));
        this.updatePosition();
    }

    // Reset camera to default position
    reset() {
        this.targetRotation.x = 0;
        this.targetRotation.y = 0;
        this.distance = 65;
        this.autoRotate = true;
        this.updatePosition();
    }

    // Handle keyboard controls
    handleKeyboard(key, step = 0.1, zoomStep = 2) {
        switch(key.toLowerCase()) {
            case 'w':
            case 'arrowup':
                this.targetRotation.x -= step;
                this.targetRotation.x = Math.max(-Math.PI/2, this.targetRotation.x);
                this.autoRotate = false;
                break;
                
            case 's':
            case 'arrowdown':
                this.targetRotation.x += step;
                this.targetRotation.x = Math.min(Math.PI/2, this.targetRotation.x);
                this.autoRotate = false;
                break;
                
            case 'a':
            case 'arrowleft':
                this.targetRotation.y -= step;
                this.autoRotate = false;
                break;
                
            case 'd':
            case 'arrowright':
                this.targetRotation.y += step;
                this.autoRotate = false;
                break;
                
            case '=':
            case '+':
                this.zoom(-zoomStep);
                break;
                
            case '-':
            case '_':
                this.zoom(zoomStep);
                break;
                
            case 'r':
                this.reset();
                break;
                
            case 'c':
                this.distance = 65;
                this.targetRotation.x = 0;
                this.targetRotation.y = 0;
                this.updatePosition();
                break;
        }
    }

    // Handle window resize
    handleResize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
}

module.exports = CameraController;

},{}],2:[function(require,module,exports){
// Server/data interaction functions - STUBBED OUT

async function fetchTileDataFromServer() {
    console.log("fetchTileDataFromServer called - returning null (stubbed)");
    return null; // No server interaction
}

async function postInitialDataToServer(tileDataArray) {
    console.log("postInitialDataToServer called with:", tileDataArray, "- no server interaction (stubbed)");
    return true; // Assume success
}

async function clearServerData() {
    console.log("clearServerData called - no server interaction (stubbed)");
    // window.location.reload(); // Might not be desired without server
}

async function exportTileDataToServer(world, TileComponent) {
    console.log("exportTileDataToServer called - no server interaction (stubbed)");
    // alert(\'Population data export is stubbed out.\');
}

module.exports = { fetchTileDataFromServer, postInitialDataToServer, clearServerData, exportTileDataToServer };

},{}],3:[function(require,module,exports){
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
        window.scene.add(backgroundSphere);

        // Initial data load and scene creation - REMOVED SERVER INTERACTION
        // let initialTileData = await fetchTileDataFromServer(); // Removed
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
            initialTileData, // This will be null
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

        // if (generatedData && generatedData.length > 0) { // Removed
            // await postInitialDataToServer(generatedData); // Removed
        // }
        
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

},{"./scene":7,"./utils":10}],4:[function(require,module,exports){
// Input Handler Module
// Centralizes all input event handling (mouse, keyboard, touch)

class InputHandler {
    constructor(renderer, cameraController, tileSelector) {
        this.renderer = renderer;
        this.cameraController = cameraController;
        this.tileSelector = tileSelector;
        
        this.mouseState = {
            isDragging: false,
            previousPosition: { x: 0, y: 0 },
            initialPosition: { x: 0, y: 0 },
            clickStartTime: 0
        };
        
        this.clickTolerance = 5;
        this.setupEventListeners();
    }

    setupEventListeners() {
        const canvas = this.renderer.domElement;
        
        // Mouse events
        canvas.addEventListener('mousedown', this.onMouseDown.bind(this), { passive: false });
        canvas.addEventListener('mousemove', this.onMouseMove.bind(this), { passive: true });
        canvas.addEventListener('mouseup', this.onMouseUp.bind(this), { passive: false });
        canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        
        // Wheel events
        window.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        
        // Keyboard events
        window.addEventListener('keydown', this.onKeyDown.bind(this), { passive: false });
        
        // Window events
        window.addEventListener('resize', this.onResize.bind(this), false);
        
        // Document click for deselection
        document.addEventListener('click', this.onDocumentClick.bind(this));
    }

    onMouseDown(event) {
        event.preventDefault();
        
        this.mouseState.isDragging = true;
        this.mouseState.previousPosition.x = event.clientX;
        this.mouseState.previousPosition.y = event.clientY;
        this.mouseState.initialPosition.x = event.clientX;
        this.mouseState.initialPosition.y = event.clientY;
        this.mouseState.clickStartTime = Date.now();
    }

    onMouseMove(event) {
        if (!this.mouseState.isDragging) return;
        
        const deltaX = event.clientX - this.mouseState.previousPosition.x;
        const deltaY = event.clientY - this.mouseState.previousPosition.y;
        
        this.cameraController.handleMouseDrag(deltaX, deltaY);
        
        this.mouseState.previousPosition.x = event.clientX;
        this.mouseState.previousPosition.y = event.clientY;
        
        // Hide tile popup during dragging
        if (this.tileSelector) {
            this.tileSelector.hidePopup();
        }
    }

    onMouseUp(event) {
        if (!this.mouseState.isDragging) return;
        
        event.preventDefault();
        
        const clickDuration = Date.now() - this.mouseState.clickStartTime;
        const clickDistance = Math.sqrt(
            Math.pow(event.clientX - this.mouseState.initialPosition.x, 2) + 
            Math.pow(event.clientY - this.mouseState.initialPosition.y, 2)
        );
        
        // If it was a quick click with minimal movement, treat it as tile selection
        if (clickDuration < 200 && clickDistance < this.clickTolerance) {
            if (this.tileSelector) {
                this.tileSelector.handleClick(event);
            }
        }
        
        this.mouseState.isDragging = false;
    }

    onMouseLeave(event) {
        if (this.mouseState.isDragging) {
            this.mouseState.isDragging = false;
        }
    }

    onWheel(event) {
        event.preventDefault();
        const delta = event.deltaY * 0.1;
        this.cameraController.zoom(delta);
    }

    onKeyDown(event) {
        // Check if user is typing in an input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }
        
        event.preventDefault();
        this.cameraController.handleKeyboard(event.key);
    }

    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight - 10;
        
        this.renderer.setSize(width, height);
        this.cameraController.handleResize(width, height);
    }

    onDocumentClick(event) {
        const container = document.getElementById("container");
        
        // Check if clicking outside the canvas
        if (!container.contains(event.target) || event.target === container) {
            if (this.tileSelector) {
                this.tileSelector.deselectAll();
            }
        }
    }

    // Public method to set tile selector reference
    setTileSelector(tileSelector) {
        this.tileSelector = tileSelector;
    }
}

module.exports = InputHandler;

},{}],5:[function(require,module,exports){
// Main Application Entry Point - Modularized GridWorld
// Coordinates all modules and initializes the application

const { fetchTileDataFromServer, postInitialDataToServer, clearServerData, exportTileDataToServer } = require('./data');
const { initializeAndStartGame } = require('./init');
const CameraController = require('./camera-controller');
const InputHandler = require('./input-handler');
const TileSelector = require('./tile-selector');
const SceneManager = require('./scene-manager');
const UIManager = require('./ui-manager');

class GridWorldApp {
    constructor() {
        this.isInitialized = false;
        this.lastTime = Date.now();
        
        // Core modules
        this.sceneManager = null;
        this.cameraController = null;
        this.inputHandler = null;
        this.tileSelector = null;
        this.uiManager = null;
        
        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
    }

    async initialize() {
        if (typeof THREE === 'undefined') {
            console.error("THREE.js not detected. Ensure that three.min.js is loaded before main.js.");
            return false;
        }

        try {
            // Initialize UI manager
            this.uiManager = new UIManager();
            this.uiManager.initialize();
            this.uiManager.showLoadingIndicator('Initializing GridWorld...');

            // Get container element
            const container = this.uiManager.getContainer();
            if (!container) return false;

            // Initialize scene manager
            const width = window.innerWidth;
            const height = window.innerHeight - 10;
            
            this.sceneManager = new SceneManager();
            const { scene, renderer } = this.sceneManager.initialize(width, height);
            this.scene = scene;
            this.renderer = renderer;

            // Create camera
            this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 200);
            
            // Initialize camera controller
            this.cameraController = new CameraController(this.camera);
            
            // Initialize tile selector
            this.tileSelector = new TileSelector(this.scene, this.camera);
            
            // Initialize input handler with references to other modules
            this.inputHandler = new InputHandler(this.renderer, this.cameraController, this.tileSelector);
            
            // Append renderer to container
            container.appendChild(this.renderer.domElement);

            // Set global references for compatibility with existing code
            this.setGlobalReferences();

            // Add lighting to scene
            this.sceneManager.addLighting();

            // Initialize the game data and create hexasphere
            await this.initializeGameData();

            this.uiManager.hideLoadingIndicator();
            this.uiManager.showMessage('GridWorld initialized successfully!', 'success');

            this.isInitialized = true;
            return true;

        } catch (error) {
            console.error('Failed to initialize GridWorld:', error);
            this.uiManager.hideLoadingIndicator();
            this.uiManager.showMessage('Failed to initialize GridWorld', 'error');
            return false;
        }
    }

    setGlobalReferences() {
        // Maintain compatibility with existing code
        window.scene = this.scene;
        window.renderer = this.renderer;
        window.camera = this.camera;
        window.hexasphere = null; // Will be set by scene manager
        window.currentTiles = [];
        window.tilePopup = document.getElementById('tilePopup');
        window.borderLines = null;
        
        // State references
        window.mouseState = {
            isDragging: false,
            previousPosition: { x: 0, y: 0 },
            initialPosition: { x: 0, y: 0 },
            clickStartTime: 0
        };
        
        window.rotationState = {
            current: { x: 0, y: 0 },
            target: { x: 0, y: 0 },
            autoRotate: true
        };
    }

    async initializeGameData() {
        try {
            // Create the hexasphere with default parameters
            const tileData = this.sceneManager.createHexasphere(30, 10, 1, null);
            
            // Initialize game logic if needed
            if (typeof initializeAndStartGame === 'function') {
                await initializeAndStartGame();
            }
            
            return tileData;
        } catch (error) {
            console.error('Failed to initialize game data:', error);
            throw error;
        }
    }

    startRenderLoop() {
        const renderLoop = () => {
            const currentTime = Date.now();
            const deltaTime = currentTime - this.lastTime;
            
            // Update camera controller
            if (this.cameraController) {
                this.cameraController.tick(deltaTime);
            }
            
            // Render the scene
            if (this.sceneManager && this.camera) {
                this.sceneManager.render(this.camera);
            }
            
            // Update stats if in debug mode
            if (window.DEBUG) {
                this.updateDebugStats(deltaTime);
            }
            
            this.lastTime = currentTime;
            requestAnimationFrame(renderLoop);
        };
        
        requestAnimationFrame(renderLoop);
    }

    updateDebugStats(deltaTime) {
        const fps = Math.round(1000 / deltaTime);
        const triangles = this.renderer.info.render.triangles;
        const calls = this.renderer.info.render.calls;
        
        this.uiManager.updateStats({
            'FPS': fps,
            'Triangles': triangles,
            'Draw Calls': calls,
            'Tiles': this.sceneManager.getCurrentTiles().length
        });
    }

    // Public API methods
    selectTile(tileId) {
        if (this.tileSelector && window.hexasphere) {
            const tile = window.hexasphere.tiles.find(t => t.id === tileId);
            if (tile) {
                this.tileSelector.selectTile(tile, { clientX: 0, clientY: 0 });
            }
        }
    }

    deselectTile() {
        if (this.tileSelector) {
            this.tileSelector.deselectAll();
        }
    }

    resetCamera() {
        if (this.cameraController) {
            this.cameraController.reset();
        }
    }

    exportData() {
        return exportTileDataToServer();
    }

    getSelectedTile() {
        return this.tileSelector ? this.tileSelector.getSelectedTile() : null;
    }
}

// Create and initialize the application
const app = new GridWorldApp();

// Initialize when DOM is ready
window.addEventListener('load', async () => {
    const success = await app.initialize();
    if (success) {
        app.startRenderLoop();
        
        // Expose app instance globally for debugging
        window.GridWorldApp = app;
    }
});

// Expose key functions globally for compatibility
window.createScene = (...args) => {
    console.warn('createScene is deprecated. Use GridWorldApp instance instead.');
    return app.sceneManager ? app.sceneManager.createHexasphere(...args) : null;
};

module.exports = GridWorldApp;

},{"./camera-controller":1,"./data":2,"./init":3,"./input-handler":4,"./scene-manager":6,"./tile-selector":8,"./ui-manager":9}],6:[function(require,module,exports){
// Scene Manager Module
// Handles scene creation, tile generation, and rendering

const { terrainColors, isLand } = require('./utils');

class SceneManager {
    constructor() {
        this.scene = null;
        this.renderer = null;
        this.hexasphere = null;
        this.currentTiles = [];
        this.tileData = {};
    }

    initialize(width, height) {
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);

        // Create scene
        this.scene = new THREE.Scene();

        return { scene: this.scene, renderer: this.renderer };
    }

    createHexasphere(radius = 30, subdivisions = 10, tileWidthRatio = 1, serverPopulationData = null) {
        // Clear existing tiles
        this.clearTiles();

        // Create new hexasphere
        this.hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);
        window.hexasphere = this.hexasphere;

        // Create unified geometry
        const hexasphereGeometry = new THREE.BufferGeometry();
        const vertices = [];
        const colors = [];
        const indices = [];
        let vertexIndex = 0;

        const generatedTileData = [];

        this.hexasphere.tiles.forEach((tile, idx) => {
            tile.id = idx;
            
            // Calculate terrain type and coordinates
            const { terrainType, lat, lon } = this.calculateTileProperties(tile);
            
            // Get color for terrain type
            const color = this.getTerrainColor(terrainType);
            
            // Create geometry for this tile
            this.addTileGeometry(tile, color, vertices, colors, indices, vertexIndex);
            vertexIndex += (tile.boundary.length - 2) * 3;

            // Store tile data
            const population = this.getTilePopulation(tile, serverPopulationData);
            this.tileData[tile.id] = {
                id: tile.id,
                tileObject: tile,
                population: population,
                latitude: lat,
                longitude: lon,
                isLand: isLand(tile.centerPoint),
                terrainType: terrainType
            };

            generatedTileData.push({
                tileId: tile.id,
                population: population,
                latitude: lat,
                longitude: lon
            });
        });

        // Create the mesh
        this.createHexasphereMesh(hexasphereGeometry, vertices, colors, indices);

        return generatedTileData;
    }

    calculateTileProperties(tile) {
        let lat = 0, lon = 0;
        
        try {
            if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
                const latLonRad = tile.centerPoint.getLatLon();
                lat = latLonRad.lat * 180 / Math.PI;
                lon = latLonRad.lon * 180 / Math.PI;
            } else {
                const r = Math.sqrt(
                    tile.centerPoint.x * tile.centerPoint.x + 
                    tile.centerPoint.y * tile.centerPoint.y + 
                    tile.centerPoint.z * tile.centerPoint.z
                );
                lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
                lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
            }
        } catch (e) {
            console.warn("Could not get lat/lon for tile:", tile.id, e);
        }

        // Determine terrain type
        let terrainType;
        if (lat >= 89 || lat <= -89) {
            terrainType = 'ice';
        } else {
            terrainType = isLand(tile.centerPoint) ? 'grassland' : 'ocean';
        }

        return { terrainType, lat, lon };
    }

    getTerrainColor(terrainType) {
        return new THREE.Color(
            terrainType === 'ice' ? 0xffffff : 
            terrainType === 'grassland' ? terrainColors.grassland : terrainColors.ocean
        );
    }

    addTileGeometry(tile, color, vertices, colors, indices, startVertexIndex) {
        const boundaryPoints = tile.boundary.map(p => new THREE.Vector3(p.x, p.y, p.z));

        // Fan triangulation
        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            // Triangle vertices
            vertices.push(boundaryPoints[0].x, boundaryPoints[0].y, boundaryPoints[0].z);
            vertices.push(boundaryPoints[i].x, boundaryPoints[i].y, boundaryPoints[i].z);
            vertices.push(boundaryPoints[i + 1].x, boundaryPoints[i + 1].y, boundaryPoints[i + 1].z);

            // Colors for each vertex
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);

            // Indices for the triangle
            indices.push(startVertexIndex, startVertexIndex + 1, startVertexIndex + 2);
            startVertexIndex += 3;
        }
    }

    getTilePopulation(tile, serverPopulationData) {
        let population = Math.floor(Math.random() * 1000);
        
        if (serverPopulationData) {
            const serverTileInfo = serverPopulationData.find(d => d.tileId === tile.id);
            if (serverTileInfo && serverTileInfo.population !== undefined) {
                population = serverTileInfo.population;
            }
        }
        
        return population;
    }

    createHexasphereMesh(geometry, vertices, colors, indices) {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshPhongMaterial({ 
            vertexColors: true,
            side: THREE.DoubleSide
        });

        const hexasphereMesh = new THREE.Mesh(geometry, material);
        hexasphereMesh.userData = { tileData: this.tileData };
        
        this.currentTiles.push(hexasphereMesh);
        this.scene.add(hexasphereMesh);
        
        // Update global reference
        window.currentTiles = this.currentTiles;
    }

    clearTiles() {
        if (this.currentTiles && this.currentTiles.length > 0) {
            this.currentTiles.forEach(tileMesh => this.scene.remove(tileMesh));
            this.currentTiles.length = 0;
        }
    }

    addLighting() {
        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        // Add directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1).normalize();
        this.scene.add(directionalLight);
    }

    render(camera) {
        this.renderer.render(this.scene, camera);
    }

    getScene() {
        return this.scene;
    }

    getRenderer() {
        return this.renderer;
    }

    getCurrentTiles() {
        return this.currentTiles;
    }

    getTileData() {
        return this.tileData;
    }
}

module.exports = SceneManager;

},{"./utils":10}],7:[function(require,module,exports){
// Three.js/scene/tile helpers
function createScene(
    radius,               // e.g., 30, the radius of the sphere
    subdivisions,         // e.g., 10, how many times to subdivide the icosahedron
    tileWidthRatio,       // e.g., 1 (for no padding between tiles, 0.9 for some padding)
    serverPopulationData, // Optional: array of data from server [{tileId, population, latitude, longitude}]
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
        }

        // Populate tile data for later use (e.g., displaying info in popups)
        let population = Math.floor(Math.random() * 1000); // Default random population if not provided
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
        }

        // If serverPopulationData is provided, try to find and use data for this tile
        const serverTileInfo = serverPopulationData ? serverPopulationData.find(d => d.tileId === tile.id) : null;
        if (serverTileInfo) {
            population = serverTileInfo.population !== undefined ? serverTileInfo.population : population;
            lat = serverTileInfo.latitude !== undefined ? serverTileInfo.latitude : lat;
            lon = serverTileInfo.longitude !== undefined ? serverTileInfo.longitude : lon;
        }

        // Store tile data
        tileData[tile.id] = {
            id: tile.id,
            tileObject: tile,
            population: population,
            latitude: lat,
            longitude: lon,
            isLand: isLand(tile.centerPoint),
            terrainType: terrainType // add terrain type for reference
        };        // Prepare data for the function's return value
        generatedTileDataForReturn.push({
            tileId: tile.id,
            population: population,
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

    // 6. Return the array of tile data (id, population, lat, lon).
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

},{}],8:[function(require,module,exports){
// Tile Selector Module
// Handles tile selection, borders, and popups

class TileSelector {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        this.selectedTile = null;
        this.borderLines = null;
        this.tilePopup = document.getElementById('tilePopup');
        
        this.borderMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            depthTest: false,
            transparent: true,
            opacity: 1
        });
    }

    handleClick(event) {
        const rect = event.target.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera({ x: mouseX, y: mouseY }, this.camera);
        
        // Get current tiles from window
        const currentTiles = window.currentTiles || [];
        const intersects = this.raycaster.intersectObjects(currentTiles);
        
        if (intersects.length > 0) {
            const intersectionPoint = intersects[0].point;
            const closestTile = this.findClosestTile(intersectionPoint);
            
            if (closestTile) {
                this.selectTile(closestTile, event);
            }
        } else {
            this.deselectAll();
        }
    }

    findClosestTile(intersectionPoint) {
        if (!window.hexasphere || !window.hexasphere.tiles) {
            return null;
        }
        
        let closestTile = null;
        let minDistance = Infinity;
        
        window.hexasphere.tiles.forEach(tile => {
            const tileCenter = new THREE.Vector3(tile.centerPoint.x, tile.centerPoint.y, tile.centerPoint.z);
            const distance = intersectionPoint.distanceTo(tileCenter);
            
            if (distance < minDistance) {
                minDistance = distance;
                closestTile = tile;
            }
        });
        
        return closestTile;
    }

    selectTile(tile, event) {
        // Check if clicking the same tile again
        if (this.selectedTile && this.selectedTile.id === tile.id) {
            this.deselectAll();
            return;
        }
        
        // Remove previous border
        this.removeBorder();
        
        // Create new border
        this.createBorder(tile);
        
        // Show popup
        this.showPopup(tile, event);
        
        this.selectedTile = tile;
    }

    createBorder(tile) {
        const borderGroup = new THREE.Group();
        
        // Create multiple thin lines offset slightly to simulate thickness
        for (let offset = 0; offset < 3; offset++) {
            const borderGeometry = new THREE.BufferGeometry();
            const borderVertices = [];
            const offsetScale = offset * 0.01;
            
            // Create lines around the tile boundary with validation
            for (let i = 0; i < tile.boundary.length; i++) {
                const current = tile.boundary[i];
                const next = tile.boundary[(i + 1) % tile.boundary.length];
                
                // Validate coordinates
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
                
                const borderMaterial = new THREE.LineBasicMaterial({
                    color: 0xff0000,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.8 - (offset * 0.1)
                });
                
                const borderLine = new THREE.LineSegments(borderGeometry, borderMaterial);
                borderGroup.add(borderLine);
            }
        }
        
        this.borderLines = borderGroup;
        this.scene.add(this.borderLines);
    }

    removeBorder() {
        if (this.borderLines) {
            this.scene.remove(this.borderLines);
            this.borderLines = null;
        }
    }

    showPopup(tile, event) {
        if (!this.tilePopup) return;
        
        let lat = 0, lon = 0;
        
        try {
            if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
                const latLon = tile.centerPoint.getLatLon(1);
                lat = latLon.lat;
                lon = latLon.lon;
            } else {
                // Fallback calculation
                const r = Math.sqrt(
                    tile.centerPoint.x * tile.centerPoint.x + 
                    tile.centerPoint.y * tile.centerPoint.y + 
                    tile.centerPoint.z * tile.centerPoint.z
                );
                lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
                lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
            }
        } catch (e) {
            console.warn("Could not get lat/lon for tile:", tile.id, e);
        }
        
        this.tilePopup.innerHTML = `
            <strong>Tile ${tile.id}</strong><br>
            Lat: ${lat.toFixed(4)}°, Lon: ${lon.toFixed(4)}°<br>
            Boundary points: ${tile.boundary.length}
        `;
        this.tilePopup.style.display = 'block';
        this.tilePopup.style.left = (event.clientX + 10) + 'px';
        this.tilePopup.style.top = (event.clientY + 10) + 'px';
    }

    hidePopup() {
        if (this.tilePopup) {
            this.tilePopup.style.display = 'none';
        }
    }

    deselectAll() {
        this.removeBorder();
        this.hidePopup();
        this.selectedTile = null;
    }

    getSelectedTile() {
        return this.selectedTile;
    }
}

module.exports = TileSelector;

},{}],9:[function(require,module,exports){
// UI Manager Module
// Handles UI setup, controls panel, and user interface interactions

class UIManager {
    constructor() {
        this.controlsPanel = null;
        this.toggleHelpButton = null;
        this.isInitialized = false;
    }

    initialize() {
        this.setupControlsPanel();
        this.isInitialized = true;
    }

    setupControlsPanel() {
        this.toggleHelpButton = document.getElementById('toggle-help');
        this.controlsPanel = document.getElementById('controls-help');
        
        if (this.toggleHelpButton && this.controlsPanel) {
            this.toggleHelpButton.addEventListener('click', () => {
                this.toggleControlsPanel();
            });
            
            // Initially show controls for a few seconds, then collapse
            setTimeout(() => {
                this.collapseControlsPanel();
            }, 5000);
        }
    }

    toggleControlsPanel() {
        if (!this.controlsPanel || !this.toggleHelpButton) return;
        
        this.controlsPanel.classList.toggle('collapsed');
        this.toggleHelpButton.textContent = this.controlsPanel.classList.contains('collapsed') ? '?' : '×';
    }

    collapseControlsPanel() {
        if (!this.controlsPanel || !this.toggleHelpButton) return;
        
        this.controlsPanel.classList.add('collapsed');
        this.toggleHelpButton.textContent = '?';
    }

    expandControlsPanel() {
        if (!this.controlsPanel || !this.toggleHelpButton) return;
        
        this.controlsPanel.classList.remove('collapsed');
        this.toggleHelpButton.textContent = '×';
    }

    showMessage(message, type = 'info', duration = 3000) {
        // Create or get message container
        let messageContainer = document.getElementById('message-container');
        if (!messageContainer) {
            messageContainer = document.createElement('div');
            messageContainer.id = 'message-container';
            messageContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 300px;
            `;
            document.body.appendChild(messageContainer);
        }

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.style.cssText = `
            padding: 12px 16px;
            margin-bottom: 10px;
            border-radius: 4px;
            color: white;
            font-family: Arial, sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            background-color: ${this.getMessageColor(type)};
        `;
        messageElement.textContent = message;

        messageContainer.appendChild(messageElement);

        // Animate in
        setTimeout(() => {
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateX(0)';
        }, 10);

        // Auto remove
        setTimeout(() => {
            this.removeMessage(messageElement);
        }, duration);

        return messageElement;
    }

    getMessageColor(type) {
        const colors = {
            'info': '#2196F3',
            'success': '#4CAF50',
            'warning': '#FF9800',
            'error': '#F44336'
        };
        return colors[type] || colors.info;
    }

    removeMessage(messageElement) {
        if (messageElement && messageElement.parentNode) {
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.parentNode.removeChild(messageElement);
                }
            }, 300);
        }
    }

    showLoadingIndicator(text = 'Loading...') {
        let loader = document.getElementById('loading-indicator');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loading-indicator';
            loader.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px 30px;
                border-radius: 8px;
                font-family: Arial, sans-serif;
                font-size: 16px;
                z-index: 10001;
                display: flex;
                align-items: center;
                gap: 15px;
            `;
            
            // Add spinner
            const spinner = document.createElement('div');
            spinner.style.cssText = `
                width: 20px;
                height: 20px;
                border: 2px solid #333;
                border-top: 2px solid #fff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            `;
            
            // Add CSS animation
            if (!document.getElementById('spinner-style')) {
                const style = document.createElement('style');
                style.id = 'spinner-style';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
            
            loader.appendChild(spinner);
            loader.appendChild(document.createTextNode(text));
            document.body.appendChild(loader);
        } else {
            loader.style.display = 'flex';
            loader.lastChild.textContent = text;
        }
        
        return loader;
    }

    hideLoadingIndicator() {
        const loader = document.getElementById('loading-indicator');
        if (loader) {
            loader.style.display = 'none';
        }
    }

    updateStats(stats) {
        // Update or create stats panel
        let statsPanel = document.getElementById('stats-panel');
        if (!statsPanel) {
            statsPanel = document.createElement('div');
            statsPanel.id = 'stats-panel';
            statsPanel.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 10px 15px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 12px;
                z-index: 1000;
            `;
            document.body.appendChild(statsPanel);
        }

        const statsText = Object.entries(stats)
            .map(([key, value]) => `${key}: ${value}`)
            .join('<br>');
        
        statsPanel.innerHTML = statsText;
    }

    getContainer() {
        const container = document.getElementById("container");
        if (!container) {
            console.error("Container element not found in HTML");
            return null;
        }
        return container;
    }

    isControlsPanelVisible() {
        return this.controlsPanel && !this.controlsPanel.classList.contains('collapsed');
    }
}

module.exports = UIManager;

},{}],10:[function(require,module,exports){
// Utility functions for GridWorld

// Define terrain colors and land function globally
const terrainColors = {
    ocean: 0x0066cc,
    grassland: 0x66cc66,
    forest: 0x228b22,
    desert: 0xffd700,
    mountain: 0x8b7355,
    tundra: 0xe0e0e0
};

const isLand = function(centerPoint) {
    // Simple land/ocean determination - you can make this more sophisticated
    const y = centerPoint.y;
    const randomFactor = Math.random();
    return y > -0.3 && randomFactor > 0.4; // Roughly 60% chance of land if above certain Y
};

// Simple dashboard update function (non-ECSY)
function updateDashboard(hexasphere) {
    if (!hexasphere || !hexasphere.tiles) return;
    
    let totalTiles = hexasphere.tiles.length;
    let landTileCount = 0;
    let totalPopulation = 0;
    
    hexasphere.tiles.forEach(tile => {
        if (isLand(tile.centerPoint)) {
            landTileCount++;
            totalPopulation += Math.floor(Math.random() * 1000); // Random population for demo
        }
    });
    
    const totalPopulationDisplay = document.getElementById('totalPopulationDisplay');
    if (totalPopulationDisplay) {
        totalPopulationDisplay.textContent = totalPopulation.toLocaleString();
    }
    const landTileCountDisplay = document.getElementById('landTileCountDisplay');
    if (landTileCountDisplay) {
        landTileCountDisplay.textContent = landTileCount.toLocaleString();
    }
}

module.exports = { updateDashboard, terrainColors, isLand };

},{}]},{},[5]);
