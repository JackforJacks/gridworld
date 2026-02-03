// Scene Manager - Main Orchestrator
// Coordinates all scene management modules
import * as THREE from 'three';
import { getAppContext } from '../../AppContext';
import populationManager from '../../../managers/population/PopulationManager';
import { getApiClient } from '../../../services/api/ApiClient';
import Hexasphere from '../../hexasphere/HexaSphere';

// Import types
import type { HexTile, HexasphereData, TileColorInfo, TileDataResponse, PopulationEventType } from './types';

// Import modules
import { initializeColorCaches, getBiomeColor, getBiomeColorCached, getTerrainColor } from './colorUtils';
import { buildTilesFromData, buildTilesFromLocalHexasphere, createHexasphereMesh, calculateTileProperties, validateTileBoundary, sanitizeBoundaryPoint, createBufferGeometry, normalizePoint } from './geometryBuilder';
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
    private sphereRadius: number;

    // State tracking
    private tileColorIndices: Map<string, TileColorInfo>;
    private overlayManager: TileOverlayManager | null;
    private populationUnsubscribe: (() => void) | null;

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
        this.sphereRadius = 30;
        this.overlayManager = null;

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
                updateTilePopulations(this.hexasphere);
                if (this.overlayManager) {
                    checkPopulationThresholds(this.hexasphere, this.tileColorIndices, this.overlayManager);
                }
            }
        });
        return { scene: this.scene, renderer: this.renderer };
    }

    async createHexasphere(radius: number | null = null, subdivisions: number | null = null, tileWidthRatio: number | null = null, forceRegenerate: boolean = false): Promise<void> {
        this.clearTiles();

        // If no parameters provided, fetch defaults from server config using ApiClient
        if (radius === null || subdivisions === null || tileWidthRatio === null) {
            try {
                const config = await getApiClient().getConfig();
                radius = radius ?? config.hexasphere.radius;
                subdivisions = subdivisions ?? config.hexasphere.subdivisions;
                tileWidthRatio = tileWidthRatio ?? config.hexasphere.tileWidthRatio;
            } catch (error: unknown) {
                console.warn('Failed to fetch config from server, using fallback defaults:', error);
                radius = radius ?? 30;
                subdivisions = subdivisions ?? 3;
                tileWidthRatio = tileWidthRatio ?? 1;
            }
        }

        await this.fetchAndBuildTiles(radius!, subdivisions!, tileWidthRatio!, forceRegenerate);
    }

    async fetchAndBuildTiles(radius: number, subdivisions: number, tileWidthRatio: number, _forceRegenerate: boolean = false): Promise<void> {
        try {
            this.sphereRadius = radius;

            // OPTIMIZED: Generate geometry locally, fetch only state from server
            // This is much faster than fetching full geometry over network

            // Step 1: Generate hexasphere locally (deterministic, same params = same result)
            const genStart = performance.now();
            const localHexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);
            const genTime = (performance.now() - genStart).toFixed(2);
            console.log(`  🌐 Hexasphere generated locally in ${genTime}ms (${localHexasphere.tiles.length} tiles)`);

            // Step 2: Fetch only tile state from server (terrain, biome, etc.)
            const fetchStart = performance.now();
            let tileState: Record<string, CompactTileState> = {};
            try {
                const stateResponse = await getApiClient().getTileState();
                tileState = stateResponse.state;
                const fetchTime = (performance.now() - fetchStart).toFixed(2);
                console.log(`  ⬇️ Tile state fetched in ${fetchTime}ms (${stateResponse.count} tiles)`);
            } catch (error: unknown) {
                console.warn('⚠️ Failed to fetch tile state, using local terrain generation:', error);
                // Continue with locally-generated terrain types
            }

            // Step 3: Build Three.js geometry from local hexasphere + server state
            const buildStart = performance.now();
            this.buildTilesFromLocalHexasphere(localHexasphere as LocalHexasphere, tileState);
            const buildTime = (performance.now() - buildStart).toFixed(2);
            console.log(`  🔨 Tiles built in ${buildTime}ms`);
        } catch (error: unknown) {
            console.error('❌ Error building hexasphere:', error);
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

        // Apply population data
        updateTilePopulations(this.hexasphere);
        if (this.overlayManager) {
            checkPopulationThresholds(this.hexasphere, this.tileColorIndices, this.overlayManager);
        }
    }

    /**
     * @deprecated Use buildTilesFromLocalHexasphere instead for better performance
     * Kept for backwards compatibility with server-provided tile data
     */
    buildTilesFromData(tileData: TileDataResponse): void {
        const result = buildTilesFromData(tileData);
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

    addTileOverlay(tile: HexTile): void {
        this.overlayManager?.add(tile);
    }

    removeTileOverlay(tileId: string): void {
        this.overlayManager?.remove(tileId);
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
            '⚠️ WARNING: This will DELETE ALL POPULATION DATA permanently!\n\n' +
            'All people, families, and villages will be wiped and regenerated.\n\n' +
            'Are you absolutely sure you want to regenerate tiles?'
        );

        if (!confirmed) return;

        try {
            // Use ApiClient for world restart
            await getApiClient().worldRestart();

            // Get config using ApiClient
            let radius = this.sphereRadius || 30;
            let subdivisions = 3;
            let tileWidthRatio = 1;

            try {
                const config = await getApiClient().getConfig();
                radius = config.hexasphere.radius;
                subdivisions = config.hexasphere.subdivisions;
                tileWidthRatio = config.hexasphere.tileWidthRatio;
            } catch (error: unknown) {
                console.warn('Failed to fetch config, using fallback values:', error);
            }

            // Clear existing mesh
            if (this.hexasphereMesh) {
                this.scene!.remove(this.hexasphereMesh);
                this.hexasphereMesh.geometry.dispose();
                (this.hexasphereMesh.material as THREE.Material).dispose();
                this.hexasphereMesh = null;
            }

            this.clearTileOverlays();

            // Apply calendar state (fetch fresh)
            await this.applyCalendarState({});

            // Fetch tiles using ApiClient (worldrestart already generated them)
            const tileData = await getApiClient().getTiles(radius, subdivisions, tileWidthRatio, false);

            this.buildTilesFromData(tileData as TileDataResponse);
        } catch (error: unknown) {
            console.error('❌ Failed to regenerate tiles:', error);
            throw error;
        }
    }

    private async applyCalendarState(_restartData: { calendarState?: unknown }): Promise<void> {
        try {
            // Fetch calendar state using ApiClient
            const result = await getApiClient().getCalendarState();
            const calendarState = result?.success ? result.data : null;

            if (calendarState && typeof calendarState === 'object') {
                const state = calendarState as { currentDate?: { year: number }; year?: number };
                const yearEl = document.getElementById('calendar-year-inline');
                if (yearEl && (state.currentDate || state.year)) {
                    yearEl.textContent = `Year: ${state.currentDate?.year ?? state.year}`;
                }
                const ctx = getAppContext();
                if (ctx.calendarManager?.updateState) {
                    try {
                        ctx.calendarManager.updateState(calendarState);
                        if (ctx.calendarDisplay?.updateDateDisplay) {
                            ctx.calendarDisplay.updateDateDisplay(calendarState);
                        }
                    } catch (e: unknown) {
                        console.warn('Failed to apply calendarState on client:', e);
                    }
                }
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

    // Legacy method - kept for compatibility
    addTileGeometry(tile: HexTile, color: THREE.Color, vertices: number[], colors: number[], indices: number[], startVertexIndex: number): void {
        const boundaryPoints = validateTileBoundary(tile);
        if (!boundaryPoints || boundaryPoints.length < 3) {
            console.warn(`Skipping tile ${tile.id}: insufficient boundary points`);
            return;
        }

        const cr = color.r, cg = color.g, cb = color.b;

        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            const p0 = boundaryPoints[0];
            const p1 = boundaryPoints[i];
            const p2 = boundaryPoints[i + 1];

            vertices.push(p0.x, p0.y, p0.z);
            vertices.push(p1.x, p1.y, p1.z);
            vertices.push(p2.x, p2.y, p2.z);
            colors.push(cr, cg, cb);
            colors.push(cr, cg, cb);
            colors.push(cr, cg, cb);
            indices.push(startVertexIndex, startVertexIndex + 1, startVertexIndex + 2);
            startVertexIndex += 3;
        }
    }

    // Legacy method - kept for compatibility
    createHexasphereMesh(geometry: THREE.BufferGeometry, vertices: number[], colors: number[], indices: number[]): void {
        createBufferGeometry(geometry, vertices, colors, indices);

        const material = new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide
        });
        const hexasphereMesh = new THREE.Mesh(geometry, material);
        this.hexasphereMesh = hexasphereMesh;
        hexasphereMesh.userData = { hexasphere: this.hexasphere };
        this.currentTiles.push(hexasphereMesh);
        this.scene!.add(hexasphereMesh);
        getAppContext().currentTiles = this.currentTiles;
    }

    clearTiles(): void {
        if (this.currentTiles?.length > 0) {
            for (const tileMesh of this.currentTiles) {
                this.scene!.remove(tileMesh);
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
        this.tileColorIndices.clear();
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
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
        if (this.scene) {
            disposeLighting(this.scene, this.lightingState);
        }
        this.overlayManager?.clear();
        this.clearTiles();
    }
}

export default SceneManager;
