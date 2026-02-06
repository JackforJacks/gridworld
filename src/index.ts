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
import HeapMeter from './components/dashboard/HeapMeter';
import BackgroundStars from './core/renderer/BackgroundStars';
import { initializeAndStartGame } from './core/scene/init';
import SocketService, { getSocketService } from './services/socket/SocketService';

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
    private heapMeter: HeapMeter | null;

    // Socket connection (via SocketService singleton)
    private socketService: SocketService | null;

    // Three.js objects
    private scene: THREE.Scene | null;
    private camera: THREE.PerspectiveCamera | null;
    private renderer: THREE.WebGLRenderer | null;

    // Animation control
    private rafId: number | null = null;
    private isAnimating = false;
    private isVisible = true;
    private visibilityHandler: (() => void) | null = null;

    // Render-on-demand: only render when something changes
    private needsRender = true;

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
        this.heapMeter = null;

        // Socket connection (via SocketService singleton)
        this.socketService = null;

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

            // Initialize camera controller with render-on-demand callback
            this.cameraController = new CameraController(this.camera, this.requestRender.bind(this));

            // Pass camera controller to UI manager for tile search feature
            this.uiManager.setCameraController(this.cameraController);

            // Initialize tile selector with scene, camera, and sceneManager
            this.tileSelector = new TileSelector(this.scene, this.camera, this.sceneManager, this.requestRender.bind(this));

            // Initialize input handler with references to other modules
            this.inputHandler = new InputHandler(this.renderer, this.cameraController, this.tileSelector);

            // Register render callback with AppContext for render-on-demand
            getAppContext().setRequestRenderCallback(() => this.requestRender());

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

            // Initialize background stars - DISABLED
            // if (typeof initStars === 'function') {
            //     initStars();
            // }

            // Create the hexasphere using server environment variables (with timing)
            console.log('🌐 Starting sphere initialization...');
            const sphereStartTime = performance.now();
            const tileData = await this.sceneManager!.createHexasphere();
            const sphereEndTime = performance.now();
            const sphereInitTime = (sphereEndTime - sphereStartTime).toFixed(2);
            console.log(`🌐 Sphere initialized in ${sphereInitTime}ms`);

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
     * Initialize socket connection using centralized SocketService
     */
    async initializeSocket(): Promise<void> {
        try {
            // Use centralized SocketService singleton
            this.socketService = getSocketService();
            await this.socketService.connect();

            // Set up socket event handlers for village updates
            this.setupSocketEventHandlers();
        } catch (error: unknown) {
            console.error('Failed to initialize socket:', error);
            // Continue without socket connection
        }
    }

    /**
     * Set up socket event handlers for real-time updates
     */
    private setupSocketEventHandlers(): void {
        if (!this.socketService) return;

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

        this.socketService.on('villageUpdated', applyVillageUpdate);
        this.socketService.on('villagesUpdated', (villages: unknown) => {
            try {
                if (!Array.isArray(villages)) return;
                (villages as VillageUpdate[]).forEach(applyVillageUpdate);
            } catch (e: unknown) {
                console.warn('Error handling villagesUpdated:', e);
            }
        });

        // Listen for auto-save completion and log timing
        this.socketService.on('autoSaveComplete', (data: unknown) => {
            const saveData = data as { success: boolean; elapsed: number; error?: string };
            if (saveData.success) {
                // [log removed]
            } else {
                console.warn(`💾 Auto-save failed in ${saveData.elapsed}ms: ${saveData.error}`);
            }
        });
    }

    /**
     * Initialize calendar system
     */
    async initializeCalendar(): Promise<void> {
        try {
            const socket = this.socketService?.getSocket();
            if (!socket) {
                console.warn('No socket connection available for calendar');
                return;
            }

            // Initialize calendar manager with socket from SocketService
            this.calendarManager = new CalendarManager(socket);

            // Initialize calendar display
            this.calendarDisplay = new CalendarDisplay(this.calendarManager);

            // Initialize heap meter
            this.heapMeter = new HeapMeter();

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

    /**
     * Request a render on the next frame (render-on-demand)
     * Called when camera moves, data updates, resize, etc.
     */
    requestRender(): void {
        this.needsRender = true;
    }

    /**
     * Shared render frame logic - called by both startRenderLoop and resumeRenderLoop
     * Prevents code duplication and ensures consistent behavior
     * @param timestamp - RAF timestamp for debug stats
     * @param currentTime - Date.now() for delta calculation
     * @returns deltaTime in ms
     */
    private renderFrame(timestamp: number, currentTime: number): number {
        const deltaTime = currentTime - this.lastTime;

        // Update camera controller - returns true if camera moved
        let cameraMoved = false;
        if (this.cameraController) {
            cameraMoved = this.cameraController.animate();
        }

        // Ensure camera matrices are up-to-date for raycasting even if we skip rendering
        if (this.camera) {
            this.camera.updateMatrixWorld();
        }

        // Determine if we need to render (render-on-demand)
        const shouldRender = this.needsRender || 
                             cameraMoved || 
                             (this.cameraController?.isAutoRotating() ?? false);

        if (shouldRender && this.sceneManager && this.camera) {
            this.sceneManager.updateCameraLight(this.camera);
            this.sceneManager.render(this.camera);
            this.needsRender = false; // Reset dirty flag
        }

        // Update stats if in debug mode (throttled to every 60 frames ~1 second)
        if (getAppContext().debug && timestamp % 60 < 1) {
            this.updateDebugStats(deltaTime);
        }

        this.lastTime = currentTime;
        return deltaTime;
    }

    startRenderLoop(): void {
        if (this.isAnimating) return; // Prevent multiple loops
        
        this.isAnimating = true;
        this.isVisible = !document.hidden;
        
        // Setup visibility handling (only once)
        if (!this.visibilityHandler) {
            this.visibilityHandler = () => {
                if (document.hidden) {
                    this.pauseRenderLoop();
                } else {
                    this.resumeRenderLoop();
                }
            };
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }

        // Frame counter for diagnostics
        let frameCount = 0;
        let lastMemoryLog = Date.now();

        // Use arrow function to avoid binding issues
        const renderLoop = (timestamp: number): void => {
            if (!this.isAnimating) return;

            // When hidden, stop RAF completely instead of running empty loops
            if (!this.isVisible) {
                return;
            }

            const currentTime = Date.now();
            frameCount++;

            // Log memory every 10 seconds
            if (currentTime - lastMemoryLog > 10000) {
                const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
                if (mem) {
                    const mb = (mem.usedJSHeapSize / 1048576).toFixed(1);
                    console.log(`[Memory] ${mb}MB after ${frameCount} frames`);
                }
                lastMemoryLog = currentTime;
            }

            // Use shared render frame logic
            this.renderFrame(timestamp, currentTime);

            this.rafId = requestAnimationFrame(renderLoop);
        };

        this.rafId = requestAnimationFrame(renderLoop);
    }

    /**
     * Pause the render loop when tab is hidden
     * Completely stops RAF to free up CPU/GPU
     */
    private pauseRenderLoop(): void {
        this.isVisible = false;
        // Cancel current RAF so the loop stops completely
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /**
     * Resume the render loop when tab becomes visible
     */
    private resumeRenderLoop(): void {
        if (!this.isVisible && this.isAnimating) {
            this.isVisible = true;
            this.lastTime = Date.now(); // Prevent large delta jump
            // Restart the RAF loop with shared render logic
            const renderLoop = (timestamp: number): void => {
                if (!this.isAnimating) return;
                if (!this.isVisible) return;

                const currentTime = Date.now();

                // Use shared render frame logic
                this.renderFrame(timestamp, currentTime);

                this.rafId = requestAnimationFrame(renderLoop);
            };
            this.rafId = requestAnimationFrame(renderLoop);
        }
    }

    /**
     * Stop the render loop completely
     */
    private stopRenderLoop(): void {
        this.isAnimating = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        // Remove visibility handler
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
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
        // Stop render loop first
        this.stopRenderLoop();

        // Clean up input handler (removes window/canvas event listeners)
        if (this.inputHandler) {
            this.inputHandler.destroy();
        }

        // Clean up heap meter
        if (this.heapMeter) {
            this.heapMeter.destroy();
        }

        // Clean up calendar display
        if (this.calendarDisplay) {
            this.calendarDisplay.destroy();
        }

        // Clean up calendar manager
        if (this.calendarManager) {
            this.calendarManager.destroy();
        }

        // Clean up tile selector
        if (this.tileSelector) {
            this.tileSelector.destroy();
        }

        // Clean up scene manager
        if (this.sceneManager) {
            this.sceneManager.cleanup();
        }

        // Dispose Three.js renderer
        if (this.renderer) {
            this.renderer.dispose();
        }

        // Disconnect PopulationManager to stop ping interval
        import('./managers/population/PopulationManager').then(({ default: pm }) => {
            pm.disconnect();
        });

        // SocketService is a singleton - disconnect it
        if (this.socketService) {
            this.socketService.disconnect();
        }

        // Clear references
        this.inputHandler = null;
        this.tileSelector = null;
        this.sceneManager = null;
        this.cameraController = null;
        this.calendarManager = null;
        this.calendarDisplay = null;
        this.heapMeter = null;
        this.socketService = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
    }
}

// Force cleanup before initialization to prevent memory accumulation
// This helps when the page is refreshed but browser keeps GPU memory
function forceCleanup(): void {
    console.log('[Init] Force cleanup running...');
    
    // Detect if DevTools might be open (can prevent GC)
    const devToolsOpen = window.outerWidth - window.innerWidth > 160 || 
                         window.outerHeight - window.innerHeight > 160;
    if (devToolsOpen) {
        console.warn('[Init] DevTools appears open - this may prevent memory cleanup');
    }

    // Clean up any existing WebGL contexts
    const canvases = document.querySelectorAll('canvas');
    console.log(`[Init] Cleaning up ${canvases.length} canvas elements`);
    canvases.forEach(canvas => {
        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
        if (gl) {
            const loseContext = gl.getExtension('WEBGL_lose_context');
            if (loseContext) {
                loseContext.loseContext();
                console.log('[Init] WebGL context lost');
            }
        }
    });

    // Clear stars container to free DOM nodes
    const starsContainer = document.getElementById('stars');
    if (starsContainer) {
        const starCount = starsContainer.children.length;
        starsContainer.innerHTML = '';
        console.log(`[Init] Cleared ${starCount} stars`);
    }

    // Force garbage collection hint (works in some browsers)
    if (window.gc) {
        window.gc();
        console.log('[Init] GC forced');
    }
}

// Run cleanup before anything else
forceCleanup();

// Store app reference globally so HMR can clean it up
let app: GridWorldApp | null = null;

// Destroy previous instance if it exists (HMR reload)
if ((window as { __gridworld_app?: GridWorldApp }).__gridworld_app) {
    console.log('[HMR] Destroying previous app instance');
    (window as { __gridworld_app?: GridWorldApp }).__gridworld_app!.destroy();
    (window as { __gridworld_app?: GridWorldApp }).__gridworld_app = undefined;
}

app = new GridWorldApp();
(window as { __gridworld_app?: GridWorldApp }).__gridworld_app = app;

// Initialize app (handles both fresh load and HMR reload)
async function initApp(): Promise<void> {
    const currentApp = app;
    if (!currentApp) return;
    const success = await currentApp.initialize();
    if (success && app === currentApp) {
        currentApp.startRenderLoop();
        (window as { GridWorldApp?: unknown }).GridWorldApp = currentApp;
    }
}

if (document.readyState === 'complete') {
    // HMR reload: page already loaded, initialize immediately
    initApp();
} else {
    // Fresh load: wait for DOM
    window.addEventListener('load', initApp);
}

// HMR: Properly dispose all GPU resources before module is replaced
const hot = (module as unknown as { hot?: { dispose: (cb: () => void) => void; accept: () => void } }).hot;
if (hot) {
    hot.dispose(() => {
        console.log('[HMR] Module disposing - cleaning up GPU resources');
        if (app) {
            app.destroy();
            app = null;
        }
        // Force WebGL context loss on all canvases
        document.querySelectorAll('canvas').forEach(canvas => {
            const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
            if (gl) {
                const ext = gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
            }
        });
    });
    hot.accept();
}

// FORCE CLEANUP on page unload/refresh to prevent memory retention
window.addEventListener('beforeunload', () => {
    console.log('[Cleanup] beforeunload - forcing cleanup');
    if (app) app.destroy();

    // Aggressive cleanup to prevent 2GB memory retention
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach(canvas => {
        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
        if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
        }
    });
    
    // Clear all intervals and timeouts
    const highestId = window.setTimeout(() => {}, 0);
    for (let i = 0; i < highestId; i++) {
        window.clearTimeout(i);
        window.clearInterval(i);
    }
});

// Also cleanup on page hide (mobile)
document.addEventListener('pagehide', () => {
    console.log('[Cleanup] pagehide - forcing cleanup');
    if (app) app.destroy();
});

// Expose key functions globally for compatibility
window.createScene = async (...args: unknown[]): Promise<unknown> => {
    console.warn('createScene is deprecated. Use GridWorldApp instance instead.');
    return app?.['sceneManager'] ? await (app as unknown as { sceneManager: SceneManager })['sceneManager'].createHexasphere() : null;
};

export default GridWorldApp;
