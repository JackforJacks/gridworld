// Import CSS (Webpack will handle this)
import '../css/styles.css';

// Main Application Entry Point - Modularized GridWorld
// Coordinates all modules and initializes the application

// Import THREE.js and make it globally available
import * as THREE from 'three';
(window as Window & { THREE: typeof THREE }).THREE = THREE;

// Import centralized application context
import AppContext, { getAppContext } from './core/AppContext';

// Import modules using modern ES6 imports
import CameraController from './core/scene/CameraController';
import InputHandler from './components/controls/InputHandler';
import TileSelector from './components/controls/TileSelector';
import SceneManager from './core/scene/SceneManager';
import UIManager from './managers/ui/UIManager';
import CalendarManager from './managers/calendar/CalendarManager';
import CalendarDisplay from './components/dashboard/CalendarDisplay';
import BackgroundStars from './core/renderer/BackgroundStars';
import { initializeAndStartGame } from './core/scene/init';
import { io, Socket } from 'socket.io-client';

// Village data structure for socket updates
interface VillageUpdate {
    id: number;
    tile_id: number;
    land_chunk_index: number;
    name?: string;
    village_name?: string;
    food_stores?: number;
    food_capacity?: number;
    food_production_rate?: number;
    housing_capacity?: number;
    housing_slots?: number[];
    occupied_slots?: number;
}

// Land chunk structure on tiles
interface LandChunk {
    chunk_index: number;
    village_id?: number;
    village_name?: string;
    food_stores?: number;
    food_capacity?: number;
    food_production_rate?: number;
    housing_capacity?: number;
    housing_slots?: number[];
    occupied_slots?: number;
}

// Extended tile with lands
interface TileWithLands {
    id: number | string;
    lands?: LandChunk[];
    [key: string]: unknown;
}

// Extend Window interface for global properties used in this module
// Note: Some properties are already declared in SceneManager.ts and global.d.ts
// Only declare properties not already defined there
declare global {
    interface Window {
        scene?: THREE.Scene | null;
        renderer?: THREE.WebGLRenderer | null;
        camera?: THREE.PerspectiveCamera | null;
        uiManager?: UIManager | null;
        tilePopup?: HTMLElement | null;
        borderLines?: THREE.Line | null;
        mouseState?: {
            isDragging: boolean;
            previousPosition: { x: number; y: number };
            initialPosition: { x: number; y: number };
            clickStartTime: number;
        };
        rotationState?: {
            current: { x: number; y: number };
            target: { x: number; y: number };
            autoRotate: boolean;
        };
        DEBUG?: boolean;
        sceneInitialized?: boolean;
        initializeAndStartGame?: () => Promise<void>;
        createScene?: (...args: unknown[]) => Promise<unknown>;
    }
}

class GridWorldApp {
    // State tracking
    private isInitialized: boolean;
    private lastTime: number;

    // Core modules
    private sceneManager: SceneManager | null;
    private cameraController: CameraController | null;
    private inputHandler: InputHandler | null;
    private tileSelector: TileSelector | null;
    private uiManager: UIManager | null;
    private calendarManager: CalendarManager | null;
    private calendarDisplay: CalendarDisplay | null;

    // Socket connection
    private socket: Socket | null;

    // Three.js objects
    private scene: THREE.Scene | null;
    private camera: THREE.PerspectiveCamera | null;
    private renderer: THREE.WebGLRenderer | null;

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

    async initialize(): Promise<boolean> {
        if (typeof THREE === 'undefined') {
            console.error("THREE.js not detected. Ensure THREE.js is loaded before the application.");
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
            this.uiManager.initialize(); // Initialize UI components
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
            this.inputHandler = new InputHandler(this.renderer, this.cameraController, this.tileSelector);

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

        } catch (error: unknown) {
            console.error('Failed to initialize GridWorld:', error);
            if (this.uiManager) this.uiManager.hideLoadingIndicator();
            if (this.uiManager) this.uiManager.showMessage('Failed to initialize GridWorld', 'error');
            return false;
        }
    }

    setGlobalReferences(): void {
        // Use centralized AppContext instead of window pollution
        const ctx = getAppContext();

        ctx.scene = this.scene;
        ctx.renderer = this.renderer;
        ctx.camera = this.camera;
        ctx.sceneManager = this.sceneManager;
        ctx.uiManager = this.uiManager;
        ctx.hexasphere = null; // Will be set by scene manager
        ctx.currentTiles = [];
        ctx.tilePopup = document.getElementById('tilePopup');
        ctx.borderLines = null;

        // State references
        ctx.mouseState = {
            isDragging: false,
            previousPosition: { x: 0, y: 0 },
            initialPosition: { x: 0, y: 0 },
            clickStartTime: 0
        };

        ctx.rotationState = {
            current: { x: 0, y: 0 },
            target: { x: 0, y: 0 },
            autoRotate: true
        };

        // Maintain minimal window compatibility for legacy code during transition
        // These can be removed once all consumers use AppContext
        window.sceneManager = this.sceneManager ?? undefined;
        // Note: window.tileSelector is set by TileSelector constructor
    }

    async initializeGameData(): Promise<void> {
        try {
            // Lazy load background stars and init module
            const [{ default: initStars }, { initializeAndStartGame }] = await Promise.all([
                import('./core/renderer/BackgroundStars'),
                import('./core/scene/init')
            ]);

            // Initialize background stars
            if (typeof initStars === 'function') {
                initStars();
            }

            // Create the hexasphere using server environment variables
            const tileData = await this.sceneManager!.createHexasphere();

            // Initialize game logic if needed
            if (typeof initializeAndStartGame === 'function') {
                await initializeAndStartGame();
            }

            return tileData;
        } catch (error: unknown) {
            console.error('Failed to initialize game data:', error);
            throw error;
        }
    }

    /**
     * Initialize socket connection
     */
    async initializeSocket(): Promise<void> {
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
                reconnectionAttempts: 5,
                path: '/socket.io'
            });

            return new Promise<void>((resolve, reject) => {
                let timedOut = false;
                const timeout = setTimeout(() => {
                    timedOut = true;
                    console.warn('Socket connection timeout — continuing without socket');
                    resolve();
                }, 10000);

                this.socket!.on('connect', () => {
                    if (!timedOut) {
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        console.info('Socket connected after timeout; continuing with existing state');
                    }
                });

                this.socket!.on('connect_error', (error: Error) => {
                    console.error('🔌 Socket connection error:', error.message);
                    if (!timedOut) {
                        clearTimeout(timeout);
                        // Don't reject - continue without socket
                        resolve();
                    }
                });

                // Apply incoming village updates to client-side tiles so UI totals refresh in real time
                const applyVillageUpdate = (village: VillageUpdate): void => {
                    try {
                        const ctx = getAppContext();
                        const sceneManager = ctx.sceneManager;
                        if (!sceneManager || !sceneManager.hexasphere) return;
                        const hexasphere = sceneManager.hexasphere as unknown as { tiles?: TileWithLands[] };
                        const tiles = hexasphere.tiles || [];
                        const tile = tiles.find((t: TileWithLands) => t.id === village.tile_id);
                        if (!tile || !Array.isArray(tile.lands)) return;
                        const land = tile.lands.find((l: LandChunk) => l.chunk_index === village.land_chunk_index);
                        if (land) {
                            land.village_id = village.id;
                            land.village_name = village.name || village.village_name || land.village_name;
                            land.food_stores = village.food_stores;
                            land.food_capacity = village.food_capacity;
                            land.food_production_rate = village.food_production_rate;
                            land.housing_capacity = village.housing_capacity;

                            // Propagate housing slot array and occupied count so client-side
                            // fallback (tile.lands -> villages) shows correct occupancy
                            if (Array.isArray(village.housing_slots)) {
                                land.housing_slots = village.housing_slots;
                                land.occupied_slots = village.housing_slots.length;
                            } else if (typeof village.occupied_slots !== 'undefined') {
                                land.occupied_slots = village.occupied_slots;
                                // keep existing housing_slots if present, else empty array
                                land.housing_slots = land.housing_slots || [];
                            }
                        }

                        // If the info panel for this tile is open, refresh it immediately
                        const selector = ctx.tileSelector;
                        if (selector && selector.infoRefreshTileId === tile.id && typeof selector.updateInfoPanel === 'function') {
                            selector.updateInfoPanel(tile);
                        }
                    } catch (e: unknown) {
                        console.warn('Error applying village update:', e);
                    }
                };

                this.socket!.on('villageUpdated', applyVillageUpdate);
                this.socket!.on('villagesUpdated', (villages: VillageUpdate[]) => {
                    try {
                        if (!Array.isArray(villages)) return;
                        villages.forEach(applyVillageUpdate);
                    } catch (e: unknown) {
                        console.warn('Error handling villagesUpdated:', e);
                    }
                });

                // Listen for auto-save completion and log timing
                this.socket!.on('autoSaveComplete', (data: { success: boolean; elapsed: number; error?: string }) => {
                    if (data.success) {
                        // [log removed]
                    } else {
                        console.warn(`💾 Auto-save failed in ${data.elapsed}ms: ${data.error}`);
                    }
                });
            });
        } catch (error: unknown) {
            console.error('Failed to initialize socket:', error);
            // Continue without socket connection
        }
    }

    /**
     * Initialize calendar system
     */
    async initializeCalendar(): Promise<void> {
        try {
            if (!this.socket) {
                console.warn('No socket connection available for calendar');
                return;
            }

            // Initialize calendar manager
            this.calendarManager = new CalendarManager(this.socket);

            // Initialize calendar display
            this.calendarDisplay = new CalendarDisplay(this.calendarManager);

        } catch (error: unknown) {
            console.error('Failed to initialize calendar system:', error);
        }
    }

    /**
     * Start calendar system after build is complete
     */
    async startCalendar(): Promise<void> {
        try {
            if (!this.calendarManager) {
                console.warn('Calendar manager not initialized');
                return;
            }

            // Start the calendar after build completion
            await this.calendarManager.start();

        } catch (error: unknown) {
            console.error('Failed to start calendar:', error);
        }
    }

    startRenderLoop(): void {
        const renderLoop = (): void => {
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
            if (getAppContext().debug) {
                this.updateDebugStats(deltaTime);
            }

            this.lastTime = currentTime;
            requestAnimationFrame(renderLoop);
        };

        requestAnimationFrame(renderLoop);
    }

    updateDebugStats(deltaTime: number): void {
        const fps = Math.round(1000 / deltaTime);
        const triangles = this.renderer!.info.render.triangles;
        const calls = this.renderer!.info.render.calls;

        // Debug stats display - could be implemented in UIManager if needed
        console.debug('Stats:', {
            'FPS': fps,
            'Triangles': triangles,
            'Draw Calls': calls,
            'Tiles': this.sceneManager!.getCurrentTiles().length
        });
    }

    // Public API methods
    selectTile(tileId: number | string): void {
        if (this.tileSelector && this.sceneManager && this.sceneManager.hexasphere) {
            const hexasphere = this.sceneManager.hexasphere as unknown as { tiles?: TileWithLands[] };
            const tiles = hexasphere.tiles || [];
            const tile = tiles.find((t: TileWithLands) => t.id === tileId);
            if (tile) {
                // Cast tile and call selectTile with one argument
                const tileAny = tile as unknown as Parameters<typeof this.tileSelector.selectTile>[0];
                this.tileSelector.selectTile(tileAny);
            }
        }
    }

    deselectTile(): void {
        if (this.tileSelector) {
            this.tileSelector.deselectAll();
        }
    }

    resetCamera(): void {
        if (this.cameraController) {
            this.cameraController.reset();
        }
    }

    exportData(): Promise<boolean> {
        // [log removed]
        return Promise.resolve(false);
    }

    getSelectedTile(): unknown {
        return this.tileSelector ? this.tileSelector.getSelectedTile() : null;
    }

    /**
     * Clean up application resources
     */
    destroy(): void {
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
        // Cast to any to avoid type conflicts with other declarations
        (window as { GridWorldApp?: unknown }).GridWorldApp = app;
    }
});

// Expose key functions globally for compatibility
window.createScene = async (...args: unknown[]): Promise<unknown> => {
    console.warn('createScene is deprecated. Use GridWorldApp instance instead.');
    return app['sceneManager'] ? await (app as unknown as { sceneManager: SceneManager })['sceneManager'].createHexasphere() : null;
};

export default GridWorldApp;
