// Import CSS (Webpack will handle this)
import '../css/styles.css';

// Main Application Entry Point - Thin Orchestrator
// Delegates to focused modules: RenderLoop, MainMenu, GameSession

import * as THREE from 'three';
(window as Window & { THREE: typeof THREE }).THREE = THREE;

import { getAppContext } from './core/AppContext';
import CameraController from './core/scene/CameraController';
import SceneManager from './core/scene/SceneManager';
import BackgroundStars, { setStarsAnimation } from './core/renderer/BackgroundStars';
import type { HexTile } from './types/shared';
import { loseAllWebGLContexts } from './utils';

// Extracted modules
import { RenderLoop } from './core/RenderLoop';
import { MainMenu, type GameConfig, type AppSettings } from './ui/MainMenu';
import { GameSession } from './core/GameSession';
import { initializeViewModeSelector } from './ui/ViewModeSelector';
import { initializeInfoPanelTabs } from './ui/InfoPanelTabs';
import { initializeSliders } from './ui/SliderControls';

declare global {
    interface Window {
        gc?: () => void;
    }
}

const appSettings: AppSettings = {
    showHeapMeter: false,
    animateBackgroundStars: true,
};

class GridWorldApp {
    private sceneManager: SceneManager | null = null;
    private cameraController: CameraController | null = null;
    private scene: THREE.Scene | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private renderer: THREE.WebGLRenderer | null = null;

    private renderLoop = new RenderLoop();
    private gameSession: GameSession | null = null;
    private menuResizeHandler: (() => void) | null = null;

    async initialize(): Promise<boolean> {
        if (typeof THREE === 'undefined') {
            console.error("THREE.js not detected.");
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

            // Create camera + auto-rotating controller
            this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 200);
            this.cameraController = new CameraController(this.camera, () => this.renderLoop.requestRender());
            this.cameraController.reset();

            // Register render callback in AppContext
            getAppContext().setRequestRenderCallback(() => this.renderLoop.requestRender());

            // Wire render loop dependencies
            this.renderLoop.setDependencies(this.sceneManager, this.cameraController, this.camera, this.renderer);

            // Append renderer to container
            const container = document.getElementById('container');
            if (!container) return false;
            container.appendChild(this.renderer.domElement);

            // Set global references
            this.setGlobalReferences();

            // Background stars + lighting
            BackgroundStars();
            this.sceneManager.addLighting(this.camera, 30);
            setTimeout(() => setStarsAnimation(appSettings.animateBackgroundStars), 100);

            // Build the hexasphere (visible behind the blurred menu)
            await this.initializeGameData();

            // Initialize UI components (extracted from inline HTML scripts)
            initializeViewModeSelector();
            initializeInfoPanelTabs();
            initializeSliders();

            // Wire up main menu
            const mainMenu = new MainMenu(
                appSettings,
                (config) => this.startGame(config),
                () => this.gameSession?.getHeapMeter() ?? null,
                (meter) => this.gameSession?.setHeapMeter(meter)
            );
            mainMenu.setup();

            // Set up resize handler for menu phase
            this.setupMenuResizeHandler();

            return true;
        } catch (error: unknown) {
            console.error('Failed to initialize GridWorld:', error);
            return false;
        }
    }

    private async startGame(config: GameConfig): Promise<void> {
        this.removeMenuResizeHandler();

        this.gameSession = new GameSession(
            this.scene!, this.camera!, this.renderer!,
            this.sceneManager!, this.cameraController!,
            appSettings,
            () => this.renderLoop.requestRender(),
            () => this.returnToMenu()
        );

        await this.gameSession.start(config);
    }

    private returnToMenu(): void {
        this.gameSession = null;
        this.cameraController?.setAutoRotate(true);
        this.setupMenuResizeHandler();

        const menu = document.getElementById('main-menu');
        if (menu) {
            menu.classList.remove('hidden');
            menu.classList.remove('fade-out');
        }
    }

    private setupMenuResizeHandler(): void {
        this.menuResizeHandler = () => {
            if (!this.renderer || !this.cameraController) return;
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.renderer.setSize(width, height);
            this.cameraController.handleResize(width, height);
            this.renderLoop.requestRender();
        };
        window.addEventListener('resize', this.menuResizeHandler);
    }

    private removeMenuResizeHandler(): void {
        if (this.menuResizeHandler) {
            window.removeEventListener('resize', this.menuResizeHandler);
            this.menuResizeHandler = null;
        }
    }

    private setGlobalReferences(): void {
        const ctx = getAppContext();
        ctx.scene = this.scene;
        ctx.renderer = this.renderer;
        ctx.camera = this.camera;
        ctx.sceneManager = this.sceneManager;
        ctx.uiManager = null;
        ctx.hexasphere = null;
        ctx.currentTiles = [];
        ctx.tilePopup = document.getElementById('tilePopup');
        ctx.borderLines = null;
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

    private async initializeGameData(): Promise<void> {
        try {
            const { initializeAndStartGame } = await import('./core/scene/init');
            const sphereStartTime = performance.now();
            await this.sceneManager!.createHexasphere();
            console.log(`Sphere initialized in ${(performance.now() - sphereStartTime).toFixed(2)}ms`);

            if (typeof initializeAndStartGame === 'function') {
                await initializeAndStartGame();
            }
        } catch (error: unknown) {
            console.error('Failed to initialize game data:', error);
            throw error;
        }
    }

    startRenderLoop(): void {
        this.renderLoop.start();
    }

    // Public API
    selectTile(tileId: number | string): void {
        const ctx = getAppContext();
        const tiles = (ctx.sceneManager?.hexasphere?.tiles || []) as HexTile[];
        const tile = tiles.find((t) => t.id === tileId);
        if (tile && ctx.tileSelector) {
            ctx.tileSelector.deselectAll();
        }
    }

    destroy(): void {
        this.renderLoop.stop();
        this.removeMenuResizeHandler();
        this.gameSession?.destroy();
        this.gameSession = null;

        if (this.sceneManager) this.sceneManager.cleanup();
        if (this.renderer) this.renderer.dispose();

        this.sceneManager = null;
        this.cameraController = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
    }
}

// ============ Bootstrap ============

function forceCleanup(): void {
    loseAllWebGLContexts();
    const starsContainer = document.getElementById('stars');
    if (starsContainer) {
        starsContainer.innerHTML = '';
    }
    if (window.gc) window.gc();
}

forceCleanup();

let app: GridWorldApp | null = null;

if ((window as { __gridworld_app?: GridWorldApp }).__gridworld_app) {
    (window as { __gridworld_app?: GridWorldApp }).__gridworld_app!.destroy();
    (window as { __gridworld_app?: GridWorldApp }).__gridworld_app = undefined;
}

app = new GridWorldApp();
(window as { __gridworld_app?: GridWorldApp }).__gridworld_app = app;

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
    initApp();
} else {
    window.addEventListener('load', initApp);
}

// HMR support
const hot = (module as unknown as { hot?: { dispose: (cb: () => void) => void; accept: () => void } }).hot;
if (hot) {
    hot.dispose(() => {
        if (app) { app.destroy(); app = null; }
        loseAllWebGLContexts();
    });
    hot.accept();
}

window.addEventListener('beforeunload', () => {
    if (app) app.destroy();
    loseAllWebGLContexts();
});

document.addEventListener('pagehide', () => {
    if (app) app.destroy();
});

export default GridWorldApp;
