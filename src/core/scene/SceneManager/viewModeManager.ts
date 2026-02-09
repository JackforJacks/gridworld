// ViewModeManager - Handles dynamic tile coloring based on view mode
import * as THREE from 'three';
import { HexTile, HexasphereData, ViewMode } from './types';
import { TileVertexRange } from './geometryBuilder';
import { terrainColors, biomeColors } from '../../../utils/colors';

/**
 * Manages view mode state and tile coloring
 * Directly modifies geometry color buffer for optimal performance
 */
export class ViewModeManager {
    private currentMode: ViewMode = 'biome';
    private hexasphereMesh: THREE.Mesh | null = null;
    private hexasphere: HexasphereData | null = null;
    private tileVertexRanges: Map<string, TileVertexRange> | null = null;

    constructor() {}

    /**
     * Initialize with mesh and tile data
     */
    initialize(
        mesh: THREE.Mesh,
        hexasphere: HexasphereData,
        tileVertexRanges: Map<string, TileVertexRange>
    ): void {
        this.hexasphereMesh = mesh;
        this.hexasphere = hexasphere;
        this.tileVertexRanges = tileVertexRanges;
        console.log('[ViewModeManager] Initialized with', hexasphere.tiles.length, 'tiles');
    }

    /**
     * Set view mode and update all tile colors
     */
    setViewMode(mode: ViewMode): void {
        if (!this.hexasphereMesh || !this.hexasphere || !this.tileVertexRanges) {
            console.warn('[ViewModeManager] Not initialized');
            return;
        }

        console.log(`[ViewModeManager] Switching to ${mode} mode`);
        this.currentMode = mode;
        this.updateAllTileColors();
    }

    /**
     * Get current view mode
     */
    getCurrentMode(): ViewMode {
        return this.currentMode;
    }

    /**
     * Update all tile colors based on current view mode
     */
    updateAllTileColors(): void {
        if (!this.hexasphereMesh || !this.hexasphere) return;

        const geometry = this.hexasphereMesh.geometry as THREE.BufferGeometry;
        const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
        const colors = colorAttr.array as Float32Array;

        // Iterate through all tiles and update their vertex colors
        for (const tile of this.hexasphere.tiles) {
            const color = this.getTileColor(tile);
            this.setTileColor(tile.id, color, colors);
        }

        // Mark attribute as needing GPU upload
        colorAttr.needsUpdate = true;
    }

    /**
     * Get color for a tile based on current view mode
     */
    private getTileColor(tile: HexTile): THREE.Color {
        switch (this.currentMode) {
            case 'terrain':
                return this.getTerrainModeColor(tile);
            case 'biome':
                return this.getBiomeModeColor(tile);
            case 'fertility':
                return this.getFertilityModeColor(tile);
            case 'population':
                return this.getPopulationModeColor(tile);
            default:
                return new THREE.Color(0x808080);
        }
    }

    /**
     * Terrain mode: Use terrainColors mapping
     */
    private getTerrainModeColor(tile: HexTile): THREE.Color {
        const terrainType = tile.terrainType || 'ocean';
        const colorValue = terrainColors[terrainType as keyof typeof terrainColors] ?? terrainColors.ocean;
        return new THREE.Color(colorValue);
    }

    /**
     * Biome mode: Use biomeColors mapping (current default)
     */
    private getBiomeModeColor(tile: HexTile): THREE.Color {
        // Ocean tiles always blue
        if (tile.terrainType === 'ocean') {
            return new THREE.Color(biomeColors.ocean);
        }

        // Use biome color if available
        if (tile.biome) {
            const colorValue = biomeColors[tile.biome as keyof typeof biomeColors];
            if (colorValue) return new THREE.Color(colorValue);
        }

        // Fallback to terrain color
        return this.getTerrainModeColor(tile);
    }

    /**
     * Fertility mode: Color gradient from red (0) to green (100)
     */
    private getFertilityModeColor(tile: HexTile): THREE.Color {
        // Ocean tiles always blue
        if (tile.terrainType === 'ocean') {
            return new THREE.Color(biomeColors.ocean);
        }

        const fertility = tile.fertility ?? 0;
        return this.fertilityGradient(fertility);
    }

    /**
     * Population mode: Color gradient from white (0) to dark blue (high)
     */
    private getPopulationModeColor(tile: HexTile): THREE.Color {
        // Ocean tiles always blue
        if (tile.terrainType === 'ocean') {
            return new THREE.Color(biomeColors.ocean);
        }

        const population = tile.population ?? 0;

        // Get max population for normalization
        const maxPop = this.getMaxPopulation();
        const normalized = maxPop > 0 ? Math.min(population / maxPop, 1.0) : 0;

        return this.populationGradient(normalized);
    }

    /**
     * Fertility gradient: Red (0) -> Yellow (50) -> Green (100)
     */
    private fertilityGradient(fertility: number): THREE.Color {
        const normalized = Math.max(0, Math.min(100, fertility)) / 100;

        if (normalized < 0.5) {
            // Red to Yellow (0-50)
            const t = normalized * 2;
            return new THREE.Color().setRGB(1.0, t, 0.0);
        } else {
            // Yellow to Green (50-100)
            const t = (normalized - 0.5) * 2;
            return new THREE.Color().setRGB(1.0 - t, 1.0, 0.0);
        }
    }

    /**
     * Population gradient: White (0) -> Light Green -> Dark Green (high)
     */
    private populationGradient(normalized: number): THREE.Color {
        // White to dark green gradient
        const r = 1.0 - (normalized * 0.9);   // 1.0 -> 0.1 (reduce red)
        const g = 1.0 - (normalized * 0.4);   // 1.0 -> 0.6 (keep more green)
        const b = 1.0 - (normalized * 0.9);   // 1.0 -> 0.1 (reduce blue)

        return new THREE.Color().setRGB(r, g, b);
    }

    /**
     * Get maximum population across all tiles for normalization
     */
    private getMaxPopulation(): number {
        if (!this.hexasphere) return 1;

        let max = 1;  // Avoid division by zero
        for (const tile of this.hexasphere.tiles) {
            if (tile.population && tile.population > max) {
                max = tile.population;
            }
        }
        return max;
    }

    /**
     * Set color for all vertices of a tile
     */
    private setTileColor(tileId: number | string, color: THREE.Color, colors: Float32Array): void {
        const range = this.tileVertexRanges?.get(String(tileId));
        if (!range) return;

        const startIdx = range.startIndex * 3;  // 3 components per vertex (RGB)
        const count = range.count;

        for (let i = 0; i < count; i++) {
            const idx = startIdx + (i * 3);
            colors[idx] = color.r;
            colors[idx + 1] = color.g;
            colors[idx + 2] = color.b;
        }
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.hexasphereMesh = null;
        this.hexasphere = null;
        this.tileVertexRanges = null;
    }
}
