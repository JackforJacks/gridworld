// Scene Manager - Main Orchestrator
// Coordinates all scene management modules
import * as THREE from 'three';
import { getAppContext } from '../../AppContext';
import populationManager from '../../../managers/population/PopulationManager';
import { getApiClient } from '../../../services/api/ApiClient';
import Hexasphere from '../../hexasphere/HexaSphere';
import { isHabitable } from '../../../utils/tileUtils';

// Import types
import type { HexTile, HexasphereData, TileColorInfo, PopulationEventType } from './types';

// Import modules
import { initializeColorCaches, getBiomeColor, getTerrainColor } from './colorUtils';
import { buildTilesFromLocalHexasphere, createHexasphereMesh, calculateTileProperties, normalizePoint } from './geometryBuilder';
import type { LocalHexasphere, CompactTileState } from './geometryBuilder';
import { TileOverlayManager } from './tileOverlays';
import { updateTilePopulations, checkPopulationThresholds, getPopulationStats, resetTileColors, initializeTilePopulations, reinitializePopulation } from './populationDisplay';
import { addLighting, updateCameraLight, disposeLighting, createLightingState, LightingState } from './lighting';

// Re-export types for external consumers
export type { BoundaryPoint, HexTile, TileColorInfo, HexasphereData, TileDataResponse, PopulationStats, TileProperties } from './types';

class SceneManager {
    // Three.js scene objects
    private scene: THREE.Scene | null;
    private renderer: THREE.WebGLRenderer | null;
    private hexasphereMesh: THREE.Mesh | null;
    private currentTiles: THREE.Mesh[];

    // Lighting state
    private lightingState: LightingState;

    // Hexasphere data (public for external access)
    public hexasphere: HexasphereData | null;
    private habitableTileIds: (number | string)[];

    // State tracking
    private tileColorIndices: Map<string, TileColorInfo>;
    private overlayManager: TileOverlayManager | null;
    private populationUnsubscribe: (() => void) | null;

    // Population update batching (RAF-throttled)
    private populationUpdatePending: boolean = false;
    private populationUpdateRafId: number | null = null;

    constructor() {
        this.scene = null;
        this.renderer = null;
        this.hexasphere = null;
        this.currentTiles = [];
        this.lightingState = createLightingState();
        this.populationUnsubscribe = null;
        this.tileColorIndices = new Map();
        this.hexasphereMesh = null;
        this.habitableTileIds = [];
        this.overlayManager = null;
        this.populationUpdatePending = false;
        this.populationUpdateRafId = null;

        // Pre-cache all biome and terrain colors
        initializeColorCaches();
    }

    initialize(width: number, height: number): { scene: THREE.Scene; renderer: THREE.WebGLRenderer } {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);
        this.scene = new THREE.Scene();
        this.overlayManager = new TileOverlayManager(this.scene);

        this.populationUnsubscribe = populationManager.subscribe((eventType: PopulationEventType, _data: unknown) => {
            if (eventType === 'populationUpdate') {
                this.schedulePopulationUpdate();
            }
        });
        return { scene: this.scene, renderer: this.renderer };
    }

    /**
     * Schedule population update with RAF batching
     * At most one update per rendered frame, combined with render-on-demand
     */
    private schedulePopulationUpdate(): void {
        // Mark that an update is needed
        this.populationUpdatePending = true;

        // If already scheduled, don't schedule again (batching)
        if (this.populationUpdateRafId !== null) return;

        // Schedule update on next frame
        this.populationUpdateRafId = requestAnimationFrame(() => {
            this.populationUpdateRafId = null;

            // Only process if still pending (might have been cancelled)
            if (!this.populationUpdatePending) return;
            this.populationUpdatePending = false;

            // Perform the actual update (iterates all tiles twice)
            updateTilePopulations(this.hexasphere);
            if (this.overlayManager) {
                checkPopulationThresholds(this.hexasphere, this.tileColorIndices, this.overlayManager);
            }

            // Trigger render via AppContext (render-on-demand)
            getAppContext().requestRender();
        });
    }

    /**
     * Cancel pending population update (e.g., during cleanup)
     */
    private cancelPendingPopulationUpdate(): void {
        this.populationUpdatePending = false;
        if (this.populationUpdateRafId !== null) {
            cancelAnimationFrame(this.populationUpdateRafId);
            this.populationUpdateRafId = null;
        }
    }

    async createHexasphere(radius: number | null = null, subdivisions: number | null = null, tileWidthRatio: number | null = null, forceRegenerate: boolean = false): Promise<void> {
        this.clearTiles();

        // If no parameters provided, fetch defaults from Tauri config
        if (radius === null || subdivisions === null || tileWidthRatio === null) {
            try {
                const config = await getApiClient().getConfig();
                radius = radius ?? config.hexasphere.radius;
                subdivisions = subdivisions ?? config.hexasphere.subdivisions;
                tileWidthRatio = tileWidthRatio ?? config.hexasphere.tile_width_ratio;
            } catch (error: unknown) {
                console.warn('Failed to fetch config, using fallback defaults:', error);
                radius = radius ?? 30;
                subdivisions = subdivisions ?? 3;
                tileWidthRatio = tileWidthRatio ?? 1;
            }
        }

        await this.fetchAndBuildTiles(radius!, subdivisions!, tileWidthRatio!, forceRegenerate);
    }

    async fetchAndBuildTiles(radius: number, subdivisions: number, tileWidthRatio: number, _forceRegenerate: boolean = false): Promise<void> {
        try {
            // Step 1: Generate hexasphere geometry locally
            const genStart = performance.now();
            const localHexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);
            const genTime = (performance.now() - genStart).toFixed(2);
            console.log(`  Hexasphere generated locally in ${genTime}ms (${localHexasphere.tiles.length} tiles)`);

            // Step 2: Calculate tile properties via Rust (terrain, biome, fertility)
            const fetchStart = performance.now();
            let tileState: Record<string, CompactTileState> = {};
            try {
                const tileCenters = localHexasphere.tiles.map((tile) => ({
                    id: tile.id as number,
                    x: tile.centerPoint.x,
                    y: tile.centerPoint.y,
                    z: tile.centerPoint.z,
                }));
                const tileProps = await getApiClient().calculateTileProperties(tileCenters);
                // Convert to CompactTileState format expected by buildTilesFromLocalHexasphere
                for (const prop of tileProps) {
                    tileState[String(prop.id)] = {
                        t: prop.terrain_type,
                        b: prop.biome,
                    };
                }
                const fetchTime = (performance.now() - fetchStart).toFixed(2);
                console.log(`  Tile properties calculated in ${fetchTime}ms (${tileProps.length} tiles)`);
            } catch (error: unknown) {
                console.warn('Failed to calculate tile properties, using local terrain generation:', error);
            }

            // Step 3: Build Three.js geometry from local hexasphere + tile state
            const buildStart = performance.now();
            this.buildTilesFromLocalHexasphere(localHexasphere as LocalHexasphere, tileState);
            const buildTime = (performance.now() - buildStart).toFixed(2);
            console.log(`  Tiles built in ${buildTime}ms`);
        } catch (error: unknown) {
            console.error('Error building hexasphere:', error);
        }
    }

    /**
     * Build tiles from locally-generated hexasphere + server state
     */
    buildTilesFromLocalHexasphere(hexasphere: LocalHexasphere, tileState: Record<string, CompactTileState>): void {
        const result = buildTilesFromLocalHexasphere(hexasphere, tileState);
        if (!result) return;

        this.hexasphere = result.hexasphere;
        this.habitableTileIds = result.habitableTileIds;
        this.tileColorIndices = result.tileColorIndices;

        // Create mesh and add to scene
        const mesh = createHexasphereMesh(result.geometry, result.hexasphere);
        this.hexasphereMesh = mesh;
        this.currentTiles.push(mesh);
        this.scene!.add(mesh);
        getAppContext().currentTiles = this.currentTiles;

        if (this.overlayManager && this.hexasphere?.tiles) {
            // Create thin black borders between tiles
            this.overlayManager.createBorders(this.hexasphere.tiles);

            // Build overlay geometry once for all habitable tiles (zero runtime allocation)
            const habitableTiles = this.hexasphere.tiles.filter(t => isHabitable(t.terrainType || 'unknown', t.biome));
            this.overlayManager.initOverlays(habitableTiles);
        }

        // Apply population data
        updateTilePopulations(this.hexasphere);
        if (this.overlayManager) {
            checkPopulationThresholds(this.hexasphere, this.tileColorIndices, this.overlayManager);
        }
    }

    async initializeTilePopulations(habitableTileIds: (number | string)[]): Promise<void> {
        if (this.overlayManager) {
            await initializeTilePopulations(habitableTileIds, this.hexasphere, this.tileColorIndices, this.overlayManager);
        }
    }

    updateTilePopulations(): void {
        updateTilePopulations(this.hexasphere);
    }

    checkPopulationThresholds(): void {
        if (!this.hexasphereMesh || !this.overlayManager) return;
        checkPopulationThresholds(this.hexasphere, this.tileColorIndices, this.overlayManager);
    }

    clearTileOverlays(): void {
        this.overlayManager?.clear();
    }

    /** 
     * Search for a tile by ID and flash it in bright red 
     * Returns the tile's center point if found, null otherwise
     */
    searchTile(tileId: number | string): { x: number; y: number; z: number } | null {
        if (!this.hexasphere || !this.overlayManager) {
            console.warn('Cannot search tile: hexasphere or overlayManager not ready');
            return null;
        }

        const id = typeof tileId === 'string' ? parseInt(tileId, 10) : tileId;

        if (isNaN(id)) {
            console.warn('Invalid tile ID:', tileId);
            return null;
        }

        // Find the tile
        const tile = this.hexasphere.tiles.find((t: HexTile) => t.id === id);

        if (!tile) {
            console.warn(`Tile ${id} not found in hexasphere`);
            return null;
        }

        // Flash the tile
        this.overlayManager.flashTile(tile);

        // Return the center point for camera targeting
        const cp = normalizePoint(tile.centerPoint);
        return {
            x: cp.x,
            y: cp.y,
            z: cp.z
        };
    }

    resetTileColors(): void {
        if (!this.hexasphere || !this.hexasphereMesh || !this.overlayManager) return;
        resetTileColors(this.hexasphere, this.tileColorIndices, this.overlayManager);
    }

    async reinitializePopulation(): Promise<void> {
        if (!this.overlayManager) return;
        this.habitableTileIds = await reinitializePopulation(
            this.hexasphere,
            this.habitableTileIds,
            this.tileColorIndices,
            this.overlayManager
        );
    }

    async regenerateTiles(): Promise<void> {
        const confirmed = window.confirm(
            'WARNING: This will DELETE ALL POPULATION DATA permanently!\n\n' +
            'All people and families will be wiped and regenerated.\n\n' +
            'Are you absolutely sure you want to regenerate tiles?'
        );

        if (!confirmed) return;

        try {
            // Restart world via Tauri with current habitable tile IDs
            const numericIds = this.habitableTileIds.map(id => typeof id === 'string' ? parseInt(id, 10) : id);
            await getApiClient().restartWorld(numericIds);

            // Refresh calendar state
            await this.applyCalendarState();

            // Rebuild hexasphere with fresh tile state
            this.clearTileOverlays();
            await this.createHexasphere();
        } catch (error: unknown) {
            console.error('Failed to regenerate tiles:', error);
            throw error;
        }
    }

    private async applyCalendarState(): Promise<void> {
        try {
            const calendarState = await getApiClient().getCalendarState();
            const yearEl = document.getElementById('calendar-year-inline');
            if (yearEl) {
                yearEl.textContent = `Year: ${calendarState.date.year}`;
            }
            const ctx = getAppContext();
            if (ctx.calendarManager?.updateState) {
                ctx.calendarManager.updateState({
                    year: calendarState.date.year,
                    month: calendarState.date.month,
                    day: calendarState.date.day,
                    isRunning: !calendarState.is_paused,
                });
            }
        } catch (_e: unknown) {
            // Ignore errors
        }
    }

    calculateTileProperties(tile: HexTile): { terrainType: string; lat: number; lon: number } {
        return calculateTileProperties(tile);
    }

    getTerrainColor(terrainType: string): THREE.Color {
        return getTerrainColor(terrainType);
    }

    getBiomeColor(tile: HexTile): THREE.Color {
        return getBiomeColor(tile);
    }

    clearTiles(): void {
        if (this.currentTiles?.length > 0) {
            for (const tileMesh of this.currentTiles) {
                this.scene!.remove(tileMesh);
                tileMesh.userData = {};  // Release hexasphere reference for GC
                if (tileMesh.geometry) tileMesh.geometry.dispose();
                if (tileMesh.material) {
                    if (Array.isArray(tileMesh.material)) {
                        for (const mat of tileMesh.material) mat.dispose();
                    } else {
                        (tileMesh.material as THREE.Material).dispose();
                    }
                }
            }
            this.currentTiles.length = 0;
        }

        if (this.hexasphereMesh) {
            this.scene!.remove(this.hexasphereMesh);
            this.hexasphereMesh.userData = {};  // Release hexasphere reference for GC
            if (this.hexasphereMesh.geometry) this.hexasphereMesh.geometry.dispose();
            if (this.hexasphereMesh.material) {
                if (Array.isArray(this.hexasphereMesh.material)) {
                    for (const mat of this.hexasphereMesh.material) mat.dispose();
                } else {
                    (this.hexasphereMesh.material as THREE.Material).dispose();
                }
            }
            this.hexasphereMesh = null;
        }

        // Clear tile borders
        if (this.overlayManager) {
            this.overlayManager.clearBorders();
        }

        this.tileColorIndices.clear();

        // Clear global reference to prevent retained mesh refs
        getAppContext().currentTiles = [];
    }

    addLighting(camera: THREE.Camera, sphereRadius: number = 30): void {
        if (!this.scene) return;
        this.lightingState = addLighting(this.scene, camera, this.lightingState, sphereRadius);
    }

    updateCameraLight(camera: THREE.Camera): void {
        // PointLight is attached to camera as child - moves automatically with camera
        updateCameraLight(camera, this.lightingState);
    }

    render(camera: THREE.Camera): void {
        this.renderer!.render(this.scene!, camera);
    }

    getScene(): THREE.Scene | null {
        return this.scene;
    }

    getRenderer(): THREE.WebGLRenderer | null {
        return this.renderer;
    }

    getCurrentTiles(): THREE.Mesh[] {
        return this.currentTiles;
    }

    getTileData(): Record<string, unknown> {
        if (!this.hexasphere?.tiles) return {};
        const tileData: Record<string, unknown> = {};
        for (const tile of this.hexasphere.tiles) {
            tileData[String(tile.id)] = tile.getProperties ? tile.getProperties() : tile;
        }
        return tileData;
    }

    getPopulationStats(): Record<string, unknown> {
        return getPopulationStats(this.hexasphere, this.tileColorIndices) as Record<string, unknown>;
    }

    cleanup(): void {
        // Cancel any pending population update RAF
        this.cancelPendingPopulationUpdate();

        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
        if (this.scene) {
            disposeLighting(this.scene, this.lightingState);
        }
        this.overlayManager?.clear();
        this.clearTiles();

        // Force WebGL context loss to free GPU memory
        if (this.renderer) {
            const canvas = this.renderer.domElement;
            const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
            if (gl) {
                const loseContext = gl.getExtension('WEBGL_lose_context');
                if (loseContext) {
                    loseContext.loseContext();
                }
            }
            this.renderer.dispose();
        }
    }
}

export default SceneManager;
