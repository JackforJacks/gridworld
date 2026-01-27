// Import CSS (Webpack will handle this)
import '../css/styles.css';

// Main Application Entry Point - Modularized GridWorld
// Coordinates all modules and initializes the application

// Import THREE.js and make it globally available
import * as THREE from 'three';
window.THREE = THREE;

// Import modules using modern ES6 imports
import CameraController from './core/scene/CameraController.js';
import InputHandler from './components/controls/InputHandler.js';
import TileSelector from './components/controls/TileSelector.js';
import SceneManager from './core/scene/SceneManager.js';
import UIManager from './managers/ui/UIManager.js';
import CalendarManager from './managers/calendar/CalendarManager.js';
import CalendarDisplay from './components/dashboard/CalendarDisplay.js';
import BackgroundStars from './core/renderer/BackgroundStars.js';
import init from './core/scene/init.js';
import { io } from 'socket.io-client';

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
        this.calendarManager = null;
        this.calendarDisplay = null;

        // Socket connection
        this.socket = null;

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
            // Initialize socket connection first
            await this.initializeSocket();

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

            // Initialize tile selector with scene, camera, and sceneManager
            this.tileSelector = new TileSelector(this.scene, this.camera, this.sceneManager);

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

            // Initialize calendar system (but don't start it yet)
            await this.initializeCalendar();

            // Start calendar after all initialization is complete
            await this.startCalendar();

            if (this.uiManager) this.uiManager.hideLoadingIndicator();
            this.isInitialized = true;
            return true;

        } catch (error) {
            console.error('Failed to initialize GridWorld:', error);
            if (this.uiManager) this.uiManager.hideLoadingIndicator();
            if (this.uiManager) this.uiManager.showMessage('Failed to initialize GridWorld', 'error');
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
                import('./core/renderer/BackgroundStars.js'),
                import('./core/scene/init.js')
            ]);

            // Initialize background stars
            if (typeof initStars === 'function') {
                initStars();
            }

            // Create the hexasphere using server environment variables
            const tileData = await this.sceneManager.createHexasphere();

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

    /**
     * Initialize socket connection
     */
    async initializeSocket() {
        try {
            // Connect directly to backend to avoid webpack-dev-server proxy issues
            this.socket = io('http://localhost:3000', {
                timeout: 30000,
                transports: ['polling'], // Use polling only (server disables upgrades)
                upgrade: false, // Disable upgrading to WebSocket
                forceNew: false,
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                maxReconnectionAttempts: 5,
                path: '/socket.io'
            });

            return new Promise((resolve, reject) => {
                let timedOut = false;
                const timeout = setTimeout(() => {
                    timedOut = true;
                    console.warn('Socket connection timeout — continuing without socket');
                    resolve();
                }, 10000);

                this.socket.on('connect', () => {
                    if (!timedOut) {
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        console.info('Socket connected after timeout; continuing with existing state');
                    }
                });

                this.socket.on('connect_error', (error) => {
                    console.error('🔌 Socket connection error:', error.message);
                    if (!timedOut) {
                        clearTimeout(timeout);
                        // Don't reject - continue without socket
                        resolve();
                    }
                });

                // Apply incoming village updates to client-side tiles so UI totals refresh in real time
                const applyVillageUpdate = (village) => {
                    try {
                        if (!window.sceneManager || !window.sceneManager.hexasphere) return;
                        const tiles = window.sceneManager.hexasphere.tiles || [];
                        const tile = tiles.find(t => t.id === village.tile_id);
                        if (!tile || !Array.isArray(tile.lands)) return;
                        const land = tile.lands.find(l => l.chunk_index === village.land_chunk_index);
                        if (land) {
                            land.village_id = village.id;
                            land.village_name = village.name || land.village_name;
                            land.food_stores = village.food_stores;
                            land.food_capacity = village.food_capacity;
                            land.food_production_rate = village.food_production_rate;
                            land.housing_capacity = village.housing_capacity;
                        }

                        // If the info panel for this tile is open, refresh it immediately
                        if (window.tileSelector && window.tileSelector.infoRefreshTileId === tile.id) {
                            window.tileSelector.updateInfoPanel(tile);
                        }
                    } catch (e) {
                        console.warn('Error applying village update:', e);
                    }
                };

                this.socket.on('villageUpdated', applyVillageUpdate);
                this.socket.on('villagesUpdated', (villages) => {
                    try {
                        if (!Array.isArray(villages)) return;
                        villages.forEach(applyVillageUpdate);
                    } catch (e) {
                        console.warn('Error handling villagesUpdated:', e);
                    }
                });

                // Listen for auto-save completion and log timing
                this.socket.on('autoSaveComplete', (data) => {
                    if (data.success) {
                        console.log(`💾 Auto-save completed in ${data.elapsed}ms`);
                    } else {
                        console.warn(`💾 Auto-save failed in ${data.elapsed}ms: ${data.error}`);
                    }
                });
            });
        } catch (error) {
            console.error('Failed to initialize socket:', error);
            // Continue without socket connection
        }
    }

    /**
     * Initialize calendar system
     */
    async initializeCalendar() {
        try {
            if (!this.socket) {
                console.warn('No socket connection available for calendar');
                return;
            }

            // Initialize calendar manager
            this.calendarManager = new CalendarManager(this.socket);

            // Initialize calendar display
            this.calendarDisplay = new CalendarDisplay(this.calendarManager);

        } catch (error) {
            console.error('Failed to initialize calendar system:', error);
        }
    }

    /**
     * Start calendar system after build is complete
     */
    async startCalendar() {
        try {
            if (!this.calendarManager) {
                console.warn('Calendar manager not initialized');
                return;
            }

            // Start the calendar after build completion
            await this.calendarManager.start();

        } catch (error) {
            console.error('Failed to start calendar:', error);
        }
    }

    startRenderLoop() {
        const renderLoop = () => {
            const currentTime = Date.now();
            const deltaTime = currentTime - this.lastTime;

            // Update camera controller
            if (this.cameraController) {
                this.cameraController.animate();
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

    /**
     * Clean up application resources
     */
    destroy() {
        if (this.calendarDisplay) {
            this.calendarDisplay.destroy();
        }

        if (this.calendarManager) {
            this.calendarManager.destroy();
        }

        if (this.socket) {
            this.socket.disconnect();
        }
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
window.createScene = async (...args) => {
    console.warn('createScene is deprecated. Use GridWorldApp instance instead.');
    return app.sceneManager ? await app.sceneManager.createHexasphere(...args) : null;
};

export default GridWorldApp;
