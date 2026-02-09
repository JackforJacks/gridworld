// Centralized color definitions and utilities for GridWorld
// Single source of truth for all terrain/biome color mappings
import * as THREE from 'three';
import type { HexTile } from '../types/shared';

// ============ Color Definitions ============

/** Terrain type to hex color mapping */
export const terrainColors: Record<string, number> = {
    ocean: 0x4A90E2,      // Light blue
    flats: 0xDAA520,      // Golden rod (yellow-brown)
    hills: 0xDEB887,      // Burlywood (very light brown)
    mountains: 0x8B4513   // Saddle brown (brown)
};

/** Biome to hex color mapping */
export const biomeColors: Record<string, number> = {
    desert: 0xF4A460,     // Sandy brown for desert
    tundra: 0xFFFFFF,     // Pure white for tundra (maximum visibility)
    grassland: 0x4CAF50,  // Grass green for grassland
    plains: 0x8FBC8F,     // Dark sea green (brownish green) for plains
    alpine: 0x8B4513,     // Dark brown for alpine (mountains)
    ocean: 0x4A90E2       // Keep ocean blue for water tiles
};

// ============ Three.js Color Caches ============

const biomeColorCache = new Map<string, THREE.Color>();
const terrainColorCache = new Map<string, THREE.Color>();
let cachesInitialized = false;

/** Initialize Three.js color caches from definitions. Called once on first use. */
export function initializeColorCaches(): void {
    if (cachesInitialized) return;

    for (const [key, value] of Object.entries(biomeColors)) {
        biomeColorCache.set(key, new THREE.Color(value));
    }
    for (const [key, value] of Object.entries(terrainColors)) {
        terrainColorCache.set(key, new THREE.Color(value));
    }

    cachesInitialized = true;
}

/** Get terrain color (returns clone for safety) */
export function getTerrainColor(terrainType: string): THREE.Color {
    initializeColorCaches();
    const cached = terrainColorCache.get(terrainType);
    if (cached) return cached.clone();
    return new THREE.Color(0x808080);
}

/** Get biome color from cache (returns reference - use for read-only) */
export function getBiomeColorCached(tile: HexTile): THREE.Color {
    initializeColorCaches();

    if (tile.terrainType === 'ocean') {
        return biomeColorCache.get('ocean') || new THREE.Color(0x2244aa);
    }

    if (tile.biome) {
        const cached = biomeColorCache.get(tile.biome);
        if (cached) return cached;
    }

    const terrainCached = terrainColorCache.get(tile.terrainType || 'ocean');
    return terrainCached || new THREE.Color(0x808080);
}

/** Get biome color with caching (returns clone for safety) */
export function getBiomeColor(tile: HexTile): THREE.Color {
    return getBiomeColorCached(tile).clone();
}

/** Get the color caches for direct access */
export function getColorCaches(): { biome: Map<string, THREE.Color>; terrain: Map<string, THREE.Color> } {
    initializeColorCaches();
    return { biome: biomeColorCache, terrain: terrainColorCache };
}
