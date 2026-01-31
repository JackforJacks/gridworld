// Scene Manager - Main Orchestrator
// Coordinates all scene management modules
import * as THREE from 'three';
import { getAppContext } from '../../AppContext';
import populationManager from '../../../managers/population/PopulationManager';

// Import types
import type { HexTile, HexasphereData, TileColorInfo, TileDataResponse, PopulationEventType } from './types';

// Import modules
import { initializeColorCaches, getBiomeColor, getBiomeColorCached, getTerrainColor } from './colorUtils';
import { buildTilesFromData, createHexasphereMesh, calculateTileProperties, validateTileBoundary, sanitizeBoundaryPoint, createBufferGeometry } from './geometryBuilder';
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

        // If no parameters provided, fetch defaults from server config
        if (radius === null || subdivisions === null || tileWidthRatio === null) {
            try {
                const configResponse = await fetch('/api/config');
                if (configResponse.ok) {
                    const config = await configResponse.json();
                    radius = radius ?? config.hexasphere.radius;
                    subdivisions = subdivisions ?? config.hexasphere.subdivisions;
                    tileWidthRatio = tileWidthRatio ?? config.hexasphere.tileWidthRatio;
                }
            } catch (error: unknown) {
                console.warn('Failed to fetch config from server, using fallback defaults:', error);
                radius = radius ?? 30;
                subdivisions = subdivisions ?? 3;
                tileWidthRatio = tileWidthRatio ?? 1;
            }
        }

        await this.fetchAndBuildTiles(radius!, subdivisions!, tileWidthRatio!, forceRegenerate);
    }

    async fetchAndBuildTiles(radius: number, subdivisions: number, tileWidthRatio: number, forceRegenerate: boolean = false): Promise<void> {
        try {
            this.sphereRadius = radius;

            const regenQuery = forceRegenerate ? '&regenerate=true' : '';
            const response = await fetch(`/api/tiles?radius=${radius}&subdivisions=${subdivisions}&tileWidthRatio=${tileWidthRatio}${regenQuery}`);
            if (!response.ok) throw new Error(`Failed to fetch tiles: ${response.status}`);
            const tileData = await response.json();
            this.buildTilesFromData(tileData);
        } catch (error: unknown) {
            console.error('❌ Error fetching tile data from server:', error);
        }
    }

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
            const restartResponse = await fetch('/api/worldrestart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' })
            });
            if (!restartResponse.ok) {
                const errorData = await restartResponse.json().catch(() => ({}));
                throw new Error(`Failed to restart world: ${restartResponse.status} - ${errorData.message || 'Unknown error'}`);
            }
            const restartData = await restartResponse.json();

            // Apply calendar state
            await this.applyCalendarState(restartData);

            // Get config
            let radius = this.sphereRadius || 30;
            let subdivisions = 3;
            let tileWidthRatio = 1;

            try {
                const configResponse = await fetch('/api/config');
                if (configResponse.ok) {
                    const config = await configResponse.json();
                    radius = config.hexasphere.radius;
                    subdivisions = config.hexasphere.subdivisions;
                    tileWidthRatio = config.hexasphere.tileWidthRatio;
                }
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

            // Fetch and rebuild
            const response = await fetch(`/api/tiles?radius=${radius}&subdivisions=${subdivisions}&tileWidthRatio=${tileWidthRatio}&regenerate=true`);
            if (!response.ok) throw new Error(`Failed to fetch tiles: ${response.status}`);
            const tileData = await response.json();

            this.buildTilesFromData(tileData);
        } catch (error: unknown) {
            console.error('❌ Failed to regenerate tiles:', error);
            throw error;
        }
    }

    private async applyCalendarState(restartData: { calendarState?: unknown }): Promise<void> {
        try {
            let calendarState = restartData?.calendarState;
            if (!calendarState) {
                try {
                    const csResp = await fetch('/api/calendar/state');
                    if (csResp.ok) {
                        const csJson = await csResp.json();
                        if (csJson?.success) calendarState = csJson.data;
                    }
                } catch (e: unknown) {
                    console.warn('Failed to fetch /api/calendar/state after restart:', e);
                }
            }

            if (calendarState && typeof calendarState === 'object') {
                const state = calendarState as { currentDate?: { year: number } };
                const yearEl = document.getElementById('calendar-year-inline');
                if (yearEl && state.currentDate) {
                    yearEl.textContent = `Year: ${state.currentDate.year}`;
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
