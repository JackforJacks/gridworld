// Scene Manager - Color Utilities
// Handles color caching and biome/terrain color lookups
import * as THREE from 'three';
import { terrainColors, biomeColors } from '../../../utils/index';
import { HexTile } from './types';

/** Color cache for biome colors */
const biomeColorCache = new Map<string, THREE.Color>();

/** Color cache for terrain colors */
const terrainColorCache = new Map<string, THREE.Color>();

/** Whether caches have been initialized */
let cachesInitialized = false;

/**
 * Initialize color caches from biome and terrain color definitions
 * Called once on first use
 */
export function initializeColorCaches(): void {
    if (cachesInitialized) return;
    
    for (const [key, value] of Object.entries(biomeColors as Record<string, number>)) {
        biomeColorCache.set(key, new THREE.Color(value));
    }
    for (const [key, value] of Object.entries(terrainColors as Record<string, number>)) {
        terrainColorCache.set(key, new THREE.Color(value));
    }
    
    cachesInitialized = true;
}

/**
 * Get terrain color (returns clone for safety)
 */
export function getTerrainColor(terrainType: string): THREE.Color {
    initializeColorCaches();
    const cached = terrainColorCache.get(terrainType);
    if (cached) return cached.clone();
    return new THREE.Color(0x808080); // Default gray
}

/**
 * Get biome color from cache (returns reference - use for read-only)
 */
export function getBiomeColorCached(tile: HexTile): THREE.Color {
    initializeColorCaches();
    
    // For ocean tiles, always use ocean color
    if (tile.terrainType === 'ocean') {
        return biomeColorCache.get('ocean') || new THREE.Color(0x2244aa);
    }
    
    // For land tiles, use biome color if available
    if (tile.biome) {
        const cached = biomeColorCache.get(tile.biome);
        if (cached) return cached;
    }
    
    // Fallback to terrain color
    const terrainCached = terrainColorCache.get(tile.terrainType || 'ocean');
    return terrainCached || new THREE.Color(0x808080);
}

/**
 * Get biome color with caching (returns clone for safety)
 */
export function getBiomeColor(tile: HexTile): THREE.Color {
    return getBiomeColorCached(tile).clone();
}

/**
 * Get the color caches for direct access
 */
export function getColorCaches(): { biome: Map<string, THREE.Color>; terrain: Map<string, THREE.Color> } {
    initializeColorCaches();
    return { biome: biomeColorCache, terrain: terrainColorCache };
}
