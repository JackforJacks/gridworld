/**
 * Tile Generator Service
 * Tiles are now deterministic from seed - no Redis storage needed
 * This module is deprecated - tiles generated on-demand by /api/tiles
 */

// Storage removed - all data in Rust ECS
import Hexasphere from '../../src/core/hexasphere/HexaSphere';
import serverConfig from '../config/server';

// Get world seed from environment
let worldSeed: number = parseInt(process.env.WORLD_SEED || '12345', 10);

type SeededRandomFn = () => number;

interface LandData {
    tile_id: number;
    chunk_index: number;
    land_type: string;
    cleared: boolean;
}

/**
 * Calculate biome based on latitude and terrain type
 */
function calculateBiome(centerPoint: { x: number; y: number; z: number }, terrainType: string, seededRandom: SeededRandomFn): string | null {
    if (!centerPoint || terrainType === 'ocean') return null;

    // Calculate latitude from y-coordinate (assuming sphere centered at origin)
    const radius = Math.sqrt(centerPoint.x ** 2 + centerPoint.y ** 2 + centerPoint.z ** 2);
    const latitude = Math.abs(Math.asin(centerPoint.y / radius) * (180 / Math.PI));

    // Biome based on latitude with some randomness
    if (latitude > 60) {
        return seededRandom() < 0.8 ? 'tundra' : 'alpine';
    } else if (latitude > 45) {
        return seededRandom() < 0.7 ? 'plains' : 'tundra';
    } else if (latitude > 30) {
        return seededRandom() < 0.6 ? 'grassland' : 'plains';
    } else if (latitude > 15) {
        return seededRandom() < 0.5 ? 'grassland' : 'desert';
    } else {
        return seededRandom() < 0.7 ? 'grassland' : 'desert';
    }
}

/**
 * Calculate fertility based on biome and terrain
 */
function calculateFertility(biome: string | null, terrainType: string, seededRandom: SeededRandomFn): number {
    if (!biome || terrainType === 'ocean' || terrainType === 'mountains') return 0;

    const baseFertility: Record<string, number> = {
        grassland: 80,
        plains: 70,
        desert: 20,
        tundra: 30,
        alpine: 25
    };

    const base = baseFertility[biome] || 50;
    const variation = Math.floor((seededRandom() - 0.5) * 20);
    return Math.max(0, Math.min(100, base + variation));
}

/**
 * Mulberry32 seeded random number generator
 */
function mulberry32(seed: number): SeededRandomFn {
    let s = seed;
    return function (): number {
        let t = s += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Get land type distribution for a tile
 */
function getLandTypeDistribution(rng: SeededRandomFn): { wasteland: number; forest: number; cleared: number } {
    const wastelandPercent = Math.floor(rng() * 31);
    let forestPercent = Math.floor(rng() * 71);
    let clearedPercent = 100 - wastelandPercent - forestPercent;
    if (clearedPercent < 0) {
        clearedPercent = 0;
        forestPercent = 100 - wastelandPercent;
    }
    return { wasteland: wastelandPercent, forest: forestPercent, cleared: clearedPercent };
}

/**
 * Regenerate tiles from hexasphere
 * Storage removed - tiles are now deterministic from seed
 * @param newSeed Optional new world seed (if not provided, uses current seed)
 * @returns Number of tiles generated
 */
export async function regenerateTiles(newSeed?: number): Promise<number> {
    // Storage removed - tiles are now deterministic from seed
    console.warn('[TileGenerator] Storage removed - tiles are deterministic from seed');

    // Use provided seed or current world seed
    const seed = newSeed ?? worldSeed;
    if (newSeed !== undefined) {
        worldSeed = newSeed;
        process.env.WORLD_SEED = seed.toString();
    }

    const radius = parseFloat(process.env.HEXASPHERE_RADIUS || '30');
    const subdivisions = parseFloat(process.env.HEXASPHERE_SUBDIVISIONS || '3');
    const tileWidthRatio = parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO || '1');

    // Create seeded random function
    let randomSeed = seed % 2147483647;
    const seededRandom = function (): number {
        randomSeed = (randomSeed * 16807) % 2147483647;
        return (randomSeed - 1) / 2147483646;
    };

    // Override Math.random temporarily
    const originalRandom = Math.random;
    Math.random = seededRandom;

    try {
        const startTime = Date.now();
        console.log(`[TileGenerator] Generating tiles with seed: ${seed}`);

        const hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);

        // Storage removed - tiles are now deterministic from seed, no Redis storage needed

        const elapsed = Date.now() - startTime;
        console.log(`[TileGenerator] ✅ Generated ${hexasphere.tiles.length} tiles (deterministic, no storage) in ${elapsed}ms`);

        return hexasphere.tiles.length;
    } finally {
        Math.random = originalRandom;
    }
}

/**
 * Get current world seed
 */
export function getWorldSeed(): number {
    return worldSeed;
}

/**
 * Set world seed
 */
export function setWorldSeed(seed: number): void {
    worldSeed = seed;
    process.env.WORLD_SEED = seed.toString();
}

export default {
    regenerateTiles,
    getWorldSeed,
    setWorldSeed
};
