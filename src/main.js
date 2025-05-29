// Import CSS (Webpack will handle this)
import '../css/styles.css';

// Main Application Entry Point - Modularized GridWorld
// Coordinates all modules and initializes the application

// Import THREE.js and make it globally available
import * as THREE from 'three';
window.THREE = THREE;

// Import modules using modern ES6 imports
import CameraController from './camera-controller.js';
import InputHandler from './input-handler.js';
import TileSelector from './Sphere/tile-selector.js';
import SceneManager from './scene-manager.js';
import UIManager from './ui-manager.js';

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
            // Initialize scene manager first, as UIManager might depend on it
            const width = window.innerWidth;
            const height = window.innerHeight - 10; // Adjust for potential UI elements

            this.sceneManager = new SceneManager();
            const { scene, renderer } = this.sceneManager.initialize(width, height);
            this.scene = scene;
            this.renderer = renderer;

            // Initialize UI manager, passing sceneManager if needed
            this.uiManager = new UIManager(this.sceneManager); // Pass sceneManager to UIManager constructor
            this.uiManager.initialize(this.sceneManager); // Or pass it here if preferred by UIManager's design
            this.uiManager.showLoadingIndicator('Initializing GridWorld...');

            // Get container element
            const container = this.uiManager.getContainer();
            if (!container) return false;

            // Create camera
            this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 200);

            // Initialize camera controller
            this.cameraController = new CameraController(this.camera);

            // Initialize tile selector
            this.tileSelector = new TileSelector(this.scene, this.camera);

            // Initialize input handler with references to other modules
            this.inputHandler = new InputHandler(this.renderer, this.cameraController, this.tileSelector, this.uiManager);

            // Append renderer to container
            container.appendChild(this.renderer.domElement);

            // Set global references for compatibility with existing code
            this.setGlobalReferences();

            // Add lighting to scene, bind to camera
            this.sceneManager.addLighting(this.camera, 30); // 30 is the default sphere radius

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
        window.sceneManager = this.sceneManager; // Expose sceneManager as single source of truth
        window.uiManager = this.uiManager; // Expose uiManager globally if needed
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
            // Lazy load background stars and init module
            const [{ default: initStars }, { initializeAndStartGame }] = await Promise.all([
                import('./BackgroundStars.js'),
                import('./init.js')
            ]);

            // Initialize background stars
            if (typeof initStars === 'function') {
                initStars();
            }

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
            // Update camera-bound light
            if (this.sceneManager && this.camera) {
                this.sceneManager.updateCameraLight(this.camera);
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
        if (this.tileSelector && this.sceneManager && this.sceneManager.hexasphere) {
            const tile = this.sceneManager.hexasphere.tiles.find(t => t.id === tileId);
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
        console.log("Data export functionality removed");
        return Promise.resolve(false);
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

export default GridWorldApp;
