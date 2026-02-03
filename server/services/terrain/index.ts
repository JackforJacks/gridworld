/**
 * Terrain & Biome Calculation Service
 * 
 * SINGLE SOURCE OF TRUTH for all terrain, biome, and habitability calculations.
 * All calculations are POSITION-BASED and DETERMINISTIC - the same tile position
 * with the same seed will ALWAYS produce the same results.
 * 
 * This module is used by:
 * - worldRestart service (primary)
 * - /api/tiles endpoint (read-only, uses stored values)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Terrain types that cannot be inhabited */
export const UNINHABITABLE_TERRAIN = ['ocean', 'mountains'] as const;

/** Biomes that cannot be inhabited */
export const UNINHABITABLE_BIOMES = ['desert', 'tundra', 'alpine'] as const;

/** Base fertility values by biome */
const BASE_FERTILITY: Record<string, number> = {
    grassland: 80,
    plains: 70,
    desert: 20,
    tundra: 30,
    alpine: 25
};

// ============================================================================
// POSITION-BASED DETERMINISTIC RANDOM
// ============================================================================

/**
 * Generate a deterministic pseudo-random value from 3D position and seed.
 * Uses a high-quality hash function to ensure good distribution.
 * 
 * @param x - X coordinate
 * @param y - Y coordinate  
 * @param z - Z coordinate
 * @param seed - World seed
 * @returns Number between 0 and 1
 */
export function positionHash(x: number, y: number, z: number, seed: number): number {
    // FNV-1a inspired hash with floating point inputs
    const h1 = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164 + seed * 0.001) * 43758.5453;
    const h2 = Math.sin(x * 39.346 + y * 11.135 + z * 83.155 + seed * 0.002) * 93751.1459;
    const combined = h1 + h2;
    return combined - Math.floor(combined);
}

/**
 * Create a multi-sample random generator for a specific position.
 * Each call returns the next deterministic random value for that position.
 */
export function createPositionRandom(x: number, y: number, z: number, seed: number) {
    let sample = 0;
    return (): number => {
        sample++;
        return positionHash(
            x + sample * 0.137,
            y + sample * 0.293,
            z + sample * 0.419,
            seed
        );
    };
}

// ============================================================================
// TERRAIN CALCULATION
// ============================================================================

/**
 * Calculate terrain type from position coordinates.
 * This is FULLY DETERMINISTIC - same position = same terrain.
 * 
 * @param x - X coordinate of tile center
 * @param y - Y coordinate of tile center
 * @param z - Z coordinate of tile center
 * @returns Terrain type: 'ocean' | 'mountains' | 'hills' | 'flats'
 */
export function calculateTerrain(x: number, y: number, z: number): string {
    // Multi-octave noise for natural-looking terrain
    const noise1 = Math.sin(x * 0.01 + z * 0.01) * Math.cos(y * 0.01);
    const noise2 = Math.sin(x * 0.02 - z * 0.02) * Math.cos(y * 0.015);
    const noise3 = Math.sin(x * 0.005 + y * 0.005 + z * 0.005);
    
    // Position-based deterministic noise (replaces Math.random())
    const posNoise = positionHash(x, y, z, 0) * 0.3 - 0.15;
    
    const elevation = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2) + posNoise;
    
    // Continent noise for land/water distribution
    const continentNoise = Math.sin(x * 0.003) * Math.cos(z * 0.003) + Math.sin(y * 0.004) * 0.5;
    const waterThreshold = 0.0 + continentNoise * 0.2;
    
    if (elevation < waterThreshold) {
        return 'ocean';
    }
    
    const landElevation = elevation - waterThreshold;
    
    if (landElevation > 0.3) {
        return 'mountains';
    } else if (landElevation > 0.15) {
        return 'hills';
    } else {
        return 'flats';
    }
}

/**
 * Check if terrain is land (not ocean)
 */
export function isLandTerrain(terrainType: string): boolean {
    return terrainType !== 'ocean';
}

// ============================================================================
// BIOME CALCULATION
// ============================================================================

/**
 * Calculate biome from position, latitude, and terrain.
 * Uses position-based random for deterministic variation.
 * 
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param z - Z coordinate
 * @param terrainType - Terrain type from calculateTerrain()
 * @param seed - World seed
 * @returns Biome name or null for ocean
 */
export function calculateBiome(
    x: number,
    y: number,
    z: number,
    terrainType: string,
    seed: number
): string | null {
    if (terrainType === 'ocean') return null;
    
    // Mountains ALWAYS have alpine biome
    if (terrainType === 'mountains') return 'alpine';
    
    // Calculate latitude from y-coordinate (sphere centered at origin)
    const radius = Math.sqrt(x * x + y * y + z * z);
    const latitude = Math.abs(Math.asin(y / radius) * (180 / Math.PI));
    
    // Position-based random for biome variation
    const rng = createPositionRandom(x, y, z, seed);
    
    // Biome based on latitude bands with variation
    if (latitude > 60) {
        return rng() < 0.8 ? 'tundra' : 'alpine';
    } else if (latitude > 45) {
        return rng() < 0.7 ? 'plains' : 'tundra';
    } else if (latitude > 30) {
        return rng() < 0.6 ? 'grassland' : 'plains';
    } else if (latitude > 15) {
        return rng() < 0.5 ? 'grassland' : 'desert';
    } else {
        return rng() < 0.7 ? 'grassland' : 'desert';
    }
}

// ============================================================================
// FERTILITY CALCULATION
// ============================================================================

/**
 * Calculate fertility from position, biome, and terrain.
 * 
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param z - Z coordinate
 * @param biome - Biome from calculateBiome()
 * @param terrainType - Terrain type
 * @param seed - World seed
 * @returns Fertility value 0-100
 */
export function calculateFertility(
    x: number,
    y: number,
    z: number,
    biome: string | null,
    terrainType: string,
    seed: number
): number {
    if (!biome || terrainType === 'ocean' || terrainType === 'mountains') {
        return 0;
    }
    
    const base = BASE_FERTILITY[biome] || 50;
    
    // Position-based variation (different seed offset to avoid correlation with biome)
    const rng = createPositionRandom(x, y, z, seed + 1000);
    const variation = Math.floor((rng() - 0.5) * 20);
    
    return Math.max(0, Math.min(100, base + variation));
}

// ============================================================================
// HABITABILITY
// ============================================================================

/**
 * Check if a tile is habitable based on terrain and biome.
 * 
 * @param terrainType - Terrain type
 * @param biome - Biome (can be null)
 * @param isLand - Whether tile is land
 * @returns true if tile can be inhabited
 */
export function isHabitable(terrainType: string, biome: string | null, isLand: boolean): boolean {
    if (!isLand) return false;
    
    if (UNINHABITABLE_TERRAIN.includes(terrainType as typeof UNINHABITABLE_TERRAIN[number])) {
        return false;
    }
    
    if (biome && UNINHABITABLE_BIOMES.includes(biome as typeof UNINHABITABLE_BIOMES[number])) {
        return false;
    }
    
    return true;
}

// ============================================================================
// LAND GENERATION
// ============================================================================

/** Land chunk data structure */
export interface LandChunk {
    tile_id: number;
    chunk_index: number;
    land_type: 'wasteland' | 'forest' | 'cleared';
    cleared: boolean;
}

/**
 * Mulberry32 seeded random number generator.
 * Used for per-tile land generation (deterministic based on tile ID).
 */
function mulberry32(seed: number): () => number {
    let s = seed;
    return function(): number {
        let t = s += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Generate land chunks for a habitable tile.
 * 
 * @param tileId - Tile ID
 * @param seed - World seed
 * @returns Array of 100 land chunks
 */
export function generateLandsForTile(tileId: number, seed: number): LandChunk[] {
    const rng = mulberry32(tileId + seed);
    
    // Determine land type distribution
    const wastelandPercent = Math.floor(rng() * 31); // 0-30%
    let forestPercent = Math.floor(rng() * 71); // 0-70%
    let clearedPercent = 100 - wastelandPercent - forestPercent;
    
    if (clearedPercent < 0) {
        clearedPercent = 0;
        forestPercent = 100 - wastelandPercent;
    }
    
    // Build land type array
    const landTypes: ('wasteland' | 'forest' | 'cleared')[] = [];
    for (let i = 0; i < wastelandPercent; i++) landTypes.push('wasteland');
    for (let i = 0; i < forestPercent; i++) landTypes.push('forest');
    while (landTypes.length < 100) landTypes.push('cleared');
    
    // Shuffle deterministically
    for (let i = landTypes.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [landTypes[i], landTypes[j]] = [landTypes[j], landTypes[i]];
    }
    
    // Create land chunks
    return landTypes.map((land_type, chunk_index) => ({
        tile_id: tileId,
        chunk_index,
        land_type,
        cleared: land_type === 'cleared'
    }));
}

// ============================================================================
// FULL TILE CALCULATION
// ============================================================================

/** Complete tile data structure */
export interface TileProperties {
    terrainType: string;
    isLand: boolean;
    biome: string | null;
    fertility: number;
    isHabitable: boolean;
    latitude: number;
    longitude: number;
}

/**
 * Calculate all properties for a tile from its center position.
 * This is the MAIN ENTRY POINT for tile property calculation.
 * 
 * @param x - X coordinate of tile center
 * @param y - Y coordinate of tile center
 * @param z - Z coordinate of tile center
 * @param seed - World seed
 * @returns Complete tile properties
 */
export function calculateTileProperties(
    x: number,
    y: number,
    z: number,
    seed: number
): TileProperties {
    const terrainType = calculateTerrain(x, y, z);
    const isLand = isLandTerrain(terrainType);
    const biome = calculateBiome(x, y, z, terrainType, seed);
    const fertility = calculateFertility(x, y, z, biome, terrainType, seed);
    const habitable = isHabitable(terrainType, biome, isLand);
    
    // Calculate lat/lon
    const radius = Math.sqrt(x * x + y * y + z * z);
    const latitude = Math.asin(y / radius) * (180 / Math.PI);
    const longitude = Math.atan2(z, x) * (180 / Math.PI);
    
    return {
        terrainType,
        isLand,
        biome,
        fertility,
        isHabitable: habitable,
        latitude,
        longitude
    };
}
