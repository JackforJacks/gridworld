// Import CSS (Webpack will handle this)
import '../css/styles.css';

// Main Application Entry Point - Modularized GridWorld
// Coordinates all modules and initializes the application

// Import THREE.js and make it globally available
import * as THREE from 'three';
(window as Window & { THREE: typeof THREE }).THREE = THREE;

// Import centralized application context
import { getAppContext } from './core/AppContext';

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
import type { HexTile } from './components/controls/TileSelector/types';
import { loseAllWebGLContexts } from './utils';
import populationManager from './managers/population/PopulationManager';
import { invoke } from '@tauri-apps/api/core';

// Extend Window interface for GC hint used in forceCleanup
declare global {
    interface Window {
        gc?: () => void;
    }
}

class GridWorldApp {
    // State tracking
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

        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
    }

    /**
     * Phase 1: Visual setup only — scene, sphere, stars, camera with auto-rotate.
     * Shows main menu overlay on top. No interactivity or simulation yet.
     */
    async initialize(): Promise<boolean> {
        if (typeof THREE === 'undefined') {
            console.error("THREE.js not detected. Ensure THREE.js is loaded before the application.");
            return false;
        }

        try {
            const width = window.innerWidth;
            const height = window.innerHeight;

            // Create scene + renderer
            this.sceneManager = new SceneManager();
            const { scene, renderer } = this.sceneManager.initialize(width, height);
            this.scene = scene;
            this.renderer = renderer;

            // Create camera + auto-rotating controller (no user input yet)
            this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 200);
            this.cameraController = new CameraController(this.camera, this.requestRender.bind(this));
            this.cameraController.reset(); // Enable auto-rotate for menu background

            // Register render callback
            getAppContext().setRequestRenderCallback(() => this.requestRender());

            // Append renderer to container
            const container = document.getElementById('container');
            if (!container) return false;
            container.appendChild(this.renderer.domElement);

            // Set global references
            this.setGlobalReferences();

            // Background stars + lighting
            BackgroundStars();
            this.sceneManager.addLighting(this.camera, 30);

            // Build the hexasphere (visible behind the blurred menu)
            await this.initializeGameData();

            // Wire up main menu buttons
            this.setupMainMenu();

            return true;

        } catch (error: unknown) {
            console.error('Failed to initialize GridWorld:', error);
            return false;
        }
    }

    /**
     * Wire up main menu button handlers
     */
    private setupMainMenu(): void {
        const btnSingleplayer = document.getElementById('btn-singleplayer');
        const btnExit = document.getElementById('btn-exit');

        if (btnSingleplayer) {
            btnSingleplayer.addEventListener('click', () => this.startGame());
        }
        if (btnExit) {
            btnExit.addEventListener('click', async () => {
                try {
                    await invoke('exit_app');
                } catch { /* fallback: do nothing */ }
            });
        }
    }

    /**
     * Phase 2: Start the game — initialize all interactive systems,
     * hide the main menu, show the dashboard.
     */
    async startGame(): Promise<void> {
        const menu = document.getElementById('main-menu');
        if (menu) {
            menu.classList.add('fade-out');
            setTimeout(() => menu.classList.add('hidden'), 500);
        }

        // Stop auto-rotate for interactive gameplay
        if (this.cameraController) this.cameraController.setAutoRotate(false);

        // Show dashboard and shift container down
        const dashboard = document.getElementById('dashboard');
        if (dashboard) dashboard.classList.remove('hidden');
        const container = document.getElementById('container');
        if (container) container.classList.add('with-dashboard');

        try {
            // Connect population manager (Tauri IPC)
            await populationManager.connect();

            // Initialize UI manager
            this.uiManager = new UIManager(this.sceneManager!);
            this.uiManager.initialize();

            // Set UIManager in AppContext
            getAppContext().uiManager = this.uiManager;

            // Pass camera controller to UI manager for tile search
            this.uiManager.setCameraController(this.cameraController!);

            // Initialize tile selector
            this.tileSelector = new TileSelector(this.scene!, this.camera!, this.sceneManager!, this.requestRender.bind(this));

            // Initialize input handler (enables mouse/keyboard interaction)
            this.inputHandler = new InputHandler(this.renderer!, this.cameraController!, this.tileSelector);

            // Initialize calendar system
            await this.initializeCalendar();
            await this.startCalendar();

            // Wire up "Back to Menu" button in the in-game menu modal
            const backBtn = document.getElementById('back-to-menu');
            if (backBtn) {
                backBtn.addEventListener('click', () => this.returnToMenu());
            }

        } catch (error: unknown) {
            console.error('Failed to start game:', error);
        }
    }

    /**
     * Tear down game systems and return to the main menu.
     */
    private returnToMenu(): void {
        // Close the menu modal
        const modalOverlay = document.getElementById('menu-modal-overlay');
        if (modalOverlay) modalOverlay.classList.add('hidden');

        // Stop calendar
        if (this.calendarManager) {
            this.calendarManager.stop();
            this.calendarManager.destroy();
            this.calendarManager = null;
        }

        // Destroy calendar display
        if (this.calendarDisplay) {
            this.calendarDisplay.destroy();
            this.calendarDisplay = null;
        }

        // Destroy heap meter
        if (this.heapMeter) {
            this.heapMeter.destroy();
            this.heapMeter = null;
        }

        // Destroy input handler
        if (this.inputHandler) {
            this.inputHandler.destroy();
            this.inputHandler = null;
        }

        // Destroy tile selector
        if (this.tileSelector) {
            this.tileSelector.destroy();
            this.tileSelector = null;
        }

        // Cleanup UI manager
        if (this.uiManager) {
            this.uiManager.cleanup();
            this.uiManager = null;
            getAppContext().uiManager = null;
        }

        // Disconnect population manager
        populationManager.disconnect();

        // Clear AppContext calendar refs
        const ctx = getAppContext();
        ctx.calendarManager = null;
        ctx.calendarDisplay = null;

        // Hide dashboard, remove container offset
        const dashboard = document.getElementById('dashboard');
        if (dashboard) dashboard.classList.add('hidden');
        const container = document.getElementById('container');
        if (container) container.classList.remove('with-dashboard');

        // Re-enable auto-rotate for menu background
        if (this.cameraController) this.cameraController.setAutoRotate(true);

        // Show main menu
        const menu = document.getElementById('main-menu');
        if (menu) {
            menu.classList.remove('hidden');
            menu.classList.remove('fade-out');
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

    }

    async initializeGameData(): Promise<void> {
        try {
            // Lazy load init module
            const { initializeAndStartGame } = await import('./core/scene/init');

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
     * Initialize calendar system
     */
    async initializeCalendar(): Promise<void> {
        try {
            // Initialize calendar manager (uses Tauri IPC directly)
            this.calendarManager = new CalendarManager();

            // Initialize calendar display
            this.calendarDisplay = new CalendarDisplay(this.calendarManager);

            // Expose to AppContext so other modules (UIManager) can access them
            const ctx = getAppContext();
            ctx.calendarManager = this.calendarManager;
            ctx.calendarDisplay = this.calendarDisplay;

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

        // Use arrow function to avoid binding issues
        const renderLoop = (timestamp: number): void => {
            if (!this.isAnimating) return;

            // When hidden, stop RAF completely instead of running empty loops
            if (!this.isVisible) {
                return;
            }

            const currentTime = Date.now();

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
            const tiles = (this.sceneManager.hexasphere.tiles || []) as HexTile[];
            const tile = tiles.find((t) => t.id === tileId);
            if (tile) {
                this.tileSelector.selectTile(tile);
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

        // Clean up UI manager (removes population subscription)
        if (this.uiManager) {
            this.uiManager.cleanup();
        }

        // Clean up scene manager
        if (this.sceneManager) {
            this.sceneManager.cleanup();
        }

        // Dispose Three.js renderer
        if (this.renderer) {
            this.renderer.dispose();
        }

        // Disconnect PopulationManager (stops Tauri event listener)
        populationManager.disconnect();

        // Clear references
        this.inputHandler = null;
        this.tileSelector = null;
        this.sceneManager = null;
        this.cameraController = null;
        this.calendarManager = null;
        this.calendarDisplay = null;
        this.heapMeter = null;
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
    loseAllWebGLContexts();

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
        loseAllWebGLContexts();
    });
    hot.accept();
}

// FORCE CLEANUP on page unload/refresh to prevent memory retention
window.addEventListener('beforeunload', () => {
    console.log('[Cleanup] beforeunload - forcing cleanup');
    if (app) app.destroy();

    // Aggressive cleanup to prevent GPU memory retention
    loseAllWebGLContexts();
});

// Also cleanup on page hide (mobile)
document.addEventListener('pagehide', () => {
    console.log('[Cleanup] pagehide - forcing cleanup');
    if (app) app.destroy();
});

export default GridWorldApp;
