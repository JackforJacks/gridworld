/**
 * AppContext - Centralized Application State Singleton
 * 
 * Replaces global window pollution with a type-safe singleton pattern.
 * All shared application state should be accessed through this context.
 */

import * as THREE from 'three';

// Forward declarations to avoid circular dependencies
// Using 'any' for manager types to allow flexible assignment from actual class instances
// while still providing basic type hints for common operations
interface SceneManagerLike {
    hexasphere?: { tiles: unknown[]; mesh?: THREE.Mesh } | null;
    getPopulationStats?: () => unknown;
}

interface UIManagerLike {
    showMessage?: (message: string, type: string) => void;
    hideLoadingIndicator?: () => void;
}

interface TileSelectorLike {
    selectedTile?: unknown;
    infoRefreshTileId?: number | string | null;
    hideInfoPanel?: () => void;
    deselectAll?: () => void;
    removeBorder?: () => void;
    updateInfoPanel?: (tile: unknown) => void;
}

interface CalendarManagerLike {
    updateState?: (state: unknown) => void;
}

interface CalendarDisplayLike {
    updateDateDisplay?: (state: unknown) => void;
}

// Hexasphere data structure
interface HexasphereData {
    tiles: unknown[];
    mesh?: THREE.Mesh;
}

// Mouse state for input handling
export interface MouseState {
    isDragging: boolean;
    previousPosition: { x: number; y: number };
    initialPosition: { x: number; y: number };
    clickStartTime: number;
}

// Rotation state for camera control
export interface RotationState {
    current: { x: number; y: number };
    target: { x: number; y: number };
    autoRotate: boolean;
}

/**
 * Application context interface
 */
interface IAppContext {
    // Three.js core objects
    scene: THREE.Scene | null;
    renderer: THREE.WebGLRenderer | null;
    camera: THREE.PerspectiveCamera | null;

    // Managers - using any to allow actual class instances
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sceneManager: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    uiManager: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tileSelector: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    calendarManager: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    calendarDisplay: any;

    // Scene data
    hexasphere: HexasphereData | null;
    currentTiles: THREE.Mesh[];

    // DOM references
    tilePopup: HTMLElement | null;
    borderLines: THREE.Line | null;

    // Input state
    mouseState: MouseState;
    rotationState: RotationState;

    // App state flags
    sceneInitialized: boolean;
    debug: boolean;

    // TileSelector internal flags
    tileSelectorJustClosed?: number;
    tileSelectorDebug: boolean;
    tileSelectorCloseHandlerAttached: boolean;
}

/**
 * AppContext Singleton Class
 * 
 * Provides centralized, type-safe access to application state.
 * Use AppContext.getInstance() to access the singleton.
 */
class AppContext implements IAppContext {
    private static instance: AppContext | null = null;

    // Three.js core objects
    public scene: THREE.Scene | null = null;
    public renderer: THREE.WebGLRenderer | null = null;
    public camera: THREE.PerspectiveCamera | null = null;

    // Managers - using 'any' internally to allow actual class instances to be assigned
    // External access via getters provides type hints
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public sceneManager: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public uiManager: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public tileSelector: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public calendarManager: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public calendarDisplay: any = null;

    // Scene data
    public hexasphere: HexasphereData | null = null;
    public currentTiles: THREE.Mesh[] = [];

    // DOM references
    public tilePopup: HTMLElement | null = null;
    public borderLines: THREE.Line | null = null;

    // Input state
    public mouseState: MouseState = {
        isDragging: false,
        previousPosition: { x: 0, y: 0 },
        initialPosition: { x: 0, y: 0 },
        clickStartTime: 0
    };

    public rotationState: RotationState = {
        current: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        autoRotate: true
    };

    // App state flags
    public sceneInitialized: boolean = false;
    public debug: boolean = false;

    // TileSelector internal flags
    public tileSelectorJustClosed?: number;
    public tileSelectorDebug: boolean = false;
    public tileSelectorCloseHandlerAttached: boolean = false;

    // Render-on-demand callback
    private requestRenderCallback: (() => void) | null = null;

    private constructor() {
        // Private constructor to enforce singleton pattern
    }

    /**
     * Get the singleton instance of AppContext
     */
    public static getInstance(): AppContext {
        if (!AppContext.instance) {
            AppContext.instance = new AppContext();
        }
        return AppContext.instance;
    }

    /**
     * Reset all state (useful for testing or world restart)
     */
    public reset(): void {
        this.scene = null;
        this.renderer = null;
        this.camera = null;
        this.sceneManager = null;
        this.uiManager = null;
        this.tileSelector = null;
        this.calendarManager = null;
        this.calendarDisplay = null;
        this.hexasphere = null;
        this.currentTiles = [];
        this.tilePopup = null;
        this.borderLines = null;
        this.mouseState = {
            isDragging: false,
            previousPosition: { x: 0, y: 0 },
            initialPosition: { x: 0, y: 0 },
            clickStartTime: 0
        };
        this.rotationState = {
            current: { x: 0, y: 0 },
            target: { x: 0, y: 0 },
            autoRotate: true
        };
        this.sceneInitialized = false;
        this.tileSelectorJustClosed = undefined;
        this.tileSelectorDebug = false;
        this.tileSelectorCloseHandlerAttached = false;
    }

    /**
     * Check if the app is fully initialized
     */
    public isInitialized(): boolean {
        return !!(this.scene && this.renderer && this.camera && this.sceneManager);
    }

    /**
     * Get hexasphere tiles safely
     */
    public getHexasphereTiles(): unknown[] {
        if (this.sceneManager?.hexasphere?.tiles) {
            return this.sceneManager.hexasphere.tiles;
        }
        if (this.hexasphere?.tiles) {
            return this.hexasphere.tiles;
        }
        return [];
    }

    /**
     * Set the render request callback for render-on-demand
     */
    public setRequestRenderCallback(callback: (() => void) | null): void {
        this.requestRenderCallback = callback;
    }

    /**
     * Request a render on the next frame (render-on-demand)
     * Safe to call from anywhere - no-op if callback not set
     */
    public requestRender(): void {
        this.requestRenderCallback?.();
    }
}

// Export singleton getter for convenience
export const getAppContext = (): AppContext => AppContext.getInstance();

export default AppContext;
