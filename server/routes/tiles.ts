// Tiles API Route
import express, { Request, Response } from 'express';
import path from 'path';
import { pathToFileURL } from 'url';
import pool from '../config/database';
import villageService from '../services/villageService';
import serverConfig from '../config/server';
import storage from '../services/storage';

// Interfaces for tile data
interface CenterPoint {
    x: number;
    y: number;
    z: number;
}

interface BoundaryPoint {
    x: number;
    y: number;
    z: number;
}

interface LandData {
    tile_id: number;
    chunk_index: number;
    land_type: string;
    cleared: boolean;
    village_id?: number;
    village_name?: string;
    housing_slots?: number;
    housing_capacity?: number;
    food_stores?: number;
    food_capacity?: number;
    food_production_rate?: number;
    last_food_update?: string;
}

interface TileData {
    id: number;
    center_x: number;
    center_y: number;
    center_z: number;
    latitude: number;
    longitude: number;
    terrain_type: string;
    is_land: boolean;
    is_habitable: boolean;
    boundary_points: string;
    neighbor_ids: string;
    biome: string | null;
    fertility: number;
}

interface TileProperties {
    id: number;
    terrainType: string;
    isLand: boolean;
    biome: string | null;
    fertility: number;
    Habitable: string;
    latitude?: number;
    longitude?: number;
    neighborIds?: number[];
    centerPoint?: CenterPoint;
    boundary?: BoundaryPoint[];
    lands?: LandData[];
}

interface VillageData {
    id: number;
    name: string;
    tile_id: number;
    land_chunk_index: number;
    housing_slots: number;
    housing_capacity: number;
    food_stores: number;
    food_capacity: number;
    food_production_rate: number;
    last_food_update: string;
}

interface TerrainCounts {
    ocean: number;
    flats: number;
    hills: number;
    mountains: number;
    [key: string]: number;
}

interface BiomeCounts {
    tundra: number;
    desert: number;
    plains: number;
    grassland: number;
    alpine: number;
    [key: string]: number;
}

type SeededRandomFn = () => number;

// __dirname is available in CommonJS mode (our server target)

const router: express.Router = express.Router();

// Helper: parse float with fallback
function parseParam(val: unknown, fallback: number): number {
    const n = parseFloat(String(val));
    return isNaN(n) ? fallback : n;
}

// Store a consistent world seed for persistent tile generation
let worldSeed: number | null = null;

// Load world seed from environment variable or use default
function loadWorldSeed() {
    if (serverConfig.verboseLogs) {
        console.log(`[API /api/tiles] Environment WORLD_SEED: ${process.env.WORLD_SEED}`);
    }
    if (process.env.WORLD_SEED) {
        worldSeed = parseInt(process.env.WORLD_SEED);
        if (serverConfig.verboseLogs) console.log(`[API /api/tiles] Using world seed from environment: ${worldSeed}`);
    } else {
        worldSeed = 12345; // Default seed
        if (serverConfig.verboseLogs) console.log(`[API /api/tiles] Using default world seed: ${worldSeed}`);
    }
}

// Initialize seed on module load
loadWorldSeed();

// Function to calculate biome based on latitude and terrain
function calculateBiome(centerPoint: CenterPoint | null, terrainType: string, seededRandom: SeededRandomFn): string | null {
    if (!centerPoint || terrainType === 'ocean') {
        return null; // Ocean tiles don't have land biomes
    }

    // Calculate latitude properly from 3D coordinates
    const r = Math.sqrt(centerPoint.x * centerPoint.x + centerPoint.y * centerPoint.y + centerPoint.z * centerPoint.z);
    const latitude = Math.asin(centerPoint.y / r) * (180 / Math.PI); // Convert to degrees
    const absLatitude = Math.abs(latitude);

    // Biome priorities: 1. Alpine (mountains), 2. Polar, 3. Latitude-based for other land
    if (terrainType === 'mountains') {
        return 'alpine';
    }
    if (absLatitude > 60) {
        return 'tundra';
    }

    // Latitude-based biomes for non-mountain, non-polar land
    if (absLatitude > 30) {
        // Temperate zones - mostly grassland, some plains
        return seededRandom() < 0.7 ? 'grassland' : 'plains';
    } else if (absLatitude > 15) {
        // Subtropical zones - mixed plains and grassland
        return seededRandom() < 0.5 ? 'plains' : 'grassland';
    } else {
        // Tropical zones - grassland savannas and some desert
        return seededRandom() < 0.6 ? 'grassland' : 'desert';
    }
}

// Function to calculate fertility based on biome and terrain type
function calculateFertility(biome: string | null, terrainType: string, seededRandom: SeededRandomFn): number {
    // Zero fertility for barren biomes and terrains
    if (terrainType === 'ocean' || terrainType === 'mountains' ||
        biome === 'desert' || biome === 'tundra' || biome === 'alpine') {
        return 0;
    }

    // For fertile biomes, calculate based on biome type and some randomness
    let baseFertility = 0;

    if (biome === 'grassland') {
        baseFertility = 70; // High fertility for grasslands
    } else if (biome === 'plains') {
        baseFertility = 85; // Very high fertility for plains
    } else {
        // Default for other land types
        baseFertility = 50;
    }

    // Add terrain modifier
    if (terrainType === 'flats') {
        baseFertility += 10; // Flat terrain is better for agriculture
    } else if (terrainType === 'hills') {
        baseFertility -= 5; // Hills are slightly less fertile
    }

    // Add random variation (-15 to +15)
    const variation = Math.floor((seededRandom() - 0.5) * 30);
    const fertility = Math.max(0, Math.min(100, baseFertility + variation));

    return fertility;
}

// GET /api/tiles
router.get('/', async (req: Request, res: Response): Promise<void> => {
    // Parse params with environment variable defaults
    const radius = parseParam(req.query.radius, parseFloat(process.env.HEXASPHERE_RADIUS || '30'));
    const subdivisions = parseParam(req.query.subdivisions, parseFloat(process.env.HEXASPHERE_SUBDIVISIONS || '3'));
    const tileWidthRatio = parseParam(req.query.tileWidthRatio, parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO || '1'));

    // Use existing world seed unless explicitly regenerating
    if (req.query.regenerate === 'true' || req.query.t) {
        // Only regenerate when explicitly requested
        const newSeed = req.query.t ? parseFloat(String(req.query.t)) : Date.now();
        if (serverConfig.verboseLogs) console.log(`[API /api/tiles] Regenerating world - old seed: ${worldSeed}, new seed: ${newSeed}`);
        worldSeed = newSeed;
        // Update environment variable for future restarts
        process.env.WORLD_SEED = worldSeed.toString();
    }

    const seed = worldSeed ?? 12345;
    const isRegenerating = req.query.regenerate === 'true' || req.query.t;

    // Override Math.random temporarily with seeded randomization
    const originalRandom = Math.random;
    let randomSeed = seed % 2147483647;

    const seededRandom = function () {
        randomSeed = (randomSeed * 16807) % 2147483647;
        return (randomSeed - 1) / 2147483646;
    };

    Math.random = seededRandom;

    try {
        // Dynamically import Hexasphere as ESM with file:// URL
        const hexasphereUrl = pathToFileURL(path.resolve(__dirname, '../../src/core/hexasphere/HexaSphere.js'));
        const HexasphereModule = await import(hexasphereUrl.href);
        const Hexasphere = HexasphereModule.default;

        if (isRegenerating) {
            if (serverConfig.verboseLogs) console.log(`[API /api/tiles] Generating tiles with seed: ${seed}`);
        }
        const hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);

        // If regenerating, store tiles and lands in Redis (will be saved to Postgres on save/autosave)
        if (isRegenerating) {
            const regenStartTime = Date.now();
            if (serverConfig.verboseLogs) console.log('[API /api/tiles] Regenerating tiles and lands in Redis...');

            // Clear existing tile data in Redis
            await storage.del('tile');
            await storage.del('tile:fertility');
            await storage.del('tile:lands');

            // Store all tile data in Redis
            const pipeline = storage.pipeline();

            for (const tile of hexasphere.tiles) {
                const props = tile.getProperties ? tile.getProperties() : tile;
                const centerPoint = tile.centerPoint ? { x: tile.centerPoint.x, y: tile.centerPoint.y, z: tile.centerPoint.z } : null;
                const biome = (centerPoint && props.isLand) ? calculateBiome(tile.centerPoint, props.terrainType, seededRandom) : null;
                const fertility = calculateFertility(biome, props.terrainType, seededRandom);
                // Check for both boolean true and string 'yes' for backward compatibility
                const isHabitableFlag = ((props.Habitable === true || props.Habitable === 'yes') && biome !== 'tundra' && biome !== 'desert' && biome !== 'alpine');

                const tileData = {
                    id: props.id,
                    center_x: centerPoint?.x || 0,
                    center_y: centerPoint?.y || 0,
                    center_z: centerPoint?.z || 0,
                    latitude: props.latitude || 0,
                    longitude: props.longitude || 0,
                    terrain_type: props.terrainType,
                    is_land: props.isLand,
                    is_habitable: isHabitableFlag,
                    boundary_points: JSON.stringify(tile.boundary ? tile.boundary.map(p => ({ x: p.x, y: p.y, z: p.z })) : []),
                    neighbor_ids: JSON.stringify(props.neighborIds || []),
                    biome: biome,
                    fertility: fertility
                };

                pipeline.hset('tile', props.id.toString(), JSON.stringify(tileData));
                if (fertility !== null) {
                    pipeline.hset('tile:fertility', props.id.toString(), fertility.toString());
                }
            }

            // Generate and store tiles_lands data in Redis
            const eligibleTiles = hexasphere.tiles.filter(tile => {
                const props = tile.getProperties ? tile.getProperties() : tile;
                const centerPoint = tile.centerPoint ? { x: tile.centerPoint.x, y: tile.centerPoint.y, z: tile.centerPoint.z } : null;
                const biome = (centerPoint && props.isLand) ? calculateBiome(tile.centerPoint, props.terrainType, seededRandom) : null;
                return props.terrainType !== 'ocean' && props.terrainType !== 'mountains' &&
                    (!biome || (biome !== 'desert' && biome !== 'tundra'));
            });

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

            function mulberry32(seed: number): SeededRandomFn {
                let s = seed;
                return function (): number {
                    let t = s += 0x6D2B79F5;
                    t = Math.imul(t ^ t >>> 15, t | 1);
                    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                    return ((t ^ t >>> 14) >>> 0) / 4294967296;
                }
            }

            for (const tile of eligibleTiles) {
                const props = tile.getProperties ? tile.getProperties() : tile;
                const rng = mulberry32(props.id);
                const dist = getLandTypeDistribution(rng);
                let landTypes: string[] = [];
                landTypes = landTypes.concat(Array<string>(dist.wasteland).fill('wasteland'));
                landTypes = landTypes.concat(Array<string>(dist.forest).fill('forest'));
                landTypes = landTypes.concat(Array<string>(100 - landTypes.length).fill('cleared'));

                for (let i = landTypes.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [landTypes[i], landTypes[j]] = [landTypes[j], landTypes[i]];
                }

                const landsData: LandData[] = [];
                for (let chunk_index = 0; chunk_index < 100; chunk_index++) {
                    landsData.push({
                        tile_id: props.id,
                        chunk_index: chunk_index,
                        land_type: landTypes[chunk_index],
                        cleared: landTypes[chunk_index] === 'cleared'
                    });
                }

                pipeline.hset('tile:lands', props.id.toString(), JSON.stringify(landsData));
            }

            await pipeline.exec();

            const regenElapsed = Date.now() - regenStartTime;
            if (serverConfig.verboseLogs) console.log(`⏱️ [API /api/tiles] Regenerated ${hexasphere.tiles.length} tiles + ${eligibleTiles.length * 100} land chunks in Redis in ${regenElapsed}ms`);

            // Mark tiles as pending for Postgres save
            await storage.sadd('pending:tiles:regenerate', 'true');
        }

        // If only regeneration side-effects are needed (no payload), exit early to keep response small
        const silentRegenerate = req.query.silent === '1' || req.query.silent === 'true';
        if (silentRegenerate) {
            Math.random = originalRandom;
            res.json({ success: true, regenerated: true, seed });
            return;
        }

        // ===== OPTIMIZED: Batch fetch all Redis data upfront =====
        // Previously: each tile made 2+ Redis calls (N+1 problem)
        // Now: fetch all data in 3 calls, then process synchronously
        let allTileData: Record<string, string> = {};
        let allLandsData: Record<string, string> = {};
        let allVillageData: Record<string, string> = {};

        try {
            const [tileDataResult, landsDataResult, villageDataResult] = await Promise.all([
                storage.hgetall('tile'),
                storage.hgetall('tile:lands'),
                storage.hgetall('village')
            ]);
            allTileData = tileDataResult || {};
            allLandsData = landsDataResult || {};
            allVillageData = villageDataResult || {};
        } catch (e: unknown) {
            console.error('[ERROR] Failed to batch fetch Redis data:', (e as Error).message);
        }

        // Build village lookup by tile_id:chunk_index for O(1) access
        const villageLookup = new Map<string, VillageData>();
        for (const [villageId, villageJson] of Object.entries(allVillageData)) {
            try {
                const village: VillageData = JSON.parse(villageJson as string);
                const key = `${village.tile_id}:${village.land_chunk_index}`;
                villageLookup.set(key, village);
            } catch (e: unknown) {
                console.warn('[tiles] Failed to parse village JSON:', villageId, (e as Error)?.message ?? e);
            }
        }

        // Collect all village IDs that need food updates
        const villageIdsToUpdate = new Set<number>();

        const tiles = hexasphere.tiles.map(tile => {
            const props = tile.getProperties ? tile.getProperties() : tile;
            // Add boundary as array of {x, y, z}
            props.boundary = tile.boundary ? tile.boundary.map(p => ({ x: p.x, y: p.y, z: p.z })) : [];
            // Add centerPoint as {x, y, z}
            if (tile.centerPoint) {
                props.centerPoint = { x: tile.centerPoint.x, y: tile.centerPoint.y, z: tile.centerPoint.z };
            } else {
                props.centerPoint = undefined;
            }

            // --- Use pre-fetched tile data from Redis ---
            try {
                const tileDataJson = allTileData[props.id.toString()];
                if (tileDataJson) {
                    const tileData = JSON.parse(tileDataJson);
                    props.terrainType = tileData.terrain_type;
                    props.isLand = tileData.is_land;
                    props.biome = tileData.biome;
                    props.fertility = tileData.fertility;
                    props.Habitable = tileData.is_habitable ? 'yes' : 'no';
                }
            } catch (e: unknown) {
                console.error(`[ERROR] Failed to parse tile data for tile ${props.id}:`, (e as Error).message);
            }

            // --- Use pre-fetched lands data from Redis ---
            try {
                const landsDataJson = allLandsData[props.id.toString()];
                if (landsDataJson) {
                    const landsData = JSON.parse(landsDataJson);
                    // Add village information using pre-built lookup (O(1) per land)
                    const landsWithVillages = landsData.map((land: LandData) => {
                        const lookupKey = `${land.tile_id}:${land.chunk_index}`;
                        const village = villageLookup.get(lookupKey);
                        if (village) {
                            villageIdsToUpdate.add(village.id);
                            return {
                                ...land,
                                village_id: village.id,
                                village_name: village.name,
                                housing_slots: village.housing_slots,
                                housing_capacity: village.housing_capacity,
                                food_stores: village.food_stores,
                                food_capacity: village.food_capacity,
                                food_production_rate: village.food_production_rate,
                                last_food_update: village.last_food_update
                            };
                        }
                        // No matching village found - return clean land without stale village data
                        const { village_id, village_name, housing_slots, housing_capacity, food_stores, food_capacity, food_production_rate, last_food_update, ...cleanLand } = land;
                        return cleanLand;
                    });
                    props.lands = landsWithVillages;
                } else {
                    props.lands = [];
                }
            } catch (e: unknown) {
                console.error(`[ERROR] Failed to parse lands for tile ${props.id}:`, (e as Error).message);
                props.lands = [];
            }
            return props;
        });

        // Update food production for all villages in parallel (batched)
        if (villageIdsToUpdate.size > 0) {
            const updatePromises = Array.from(villageIdsToUpdate).map(async villageId => {
                try {
                    await villageService.updateVillageFoodProduction(villageId);
                    await villageService.updateVillageFoodStores(villageId);
                } catch (err: unknown) {
                    console.error(`[ERROR] Failed to update food for village ${villageId}:`, (err as Error).message);
                }
            });
            await Promise.all(updatePromises);
        }

        // Restore original Math.random
        Math.random = originalRandom;

        res.json({ tiles });
    } catch (err: unknown) {
        // Restore original Math.random in case of error
        Math.random = originalRandom;
        const error = err as Error;
        res.status(500).json({ error: 'Failed to generate tiles', details: error.message });
    }
});

// POST /api/tiles/restart - DEPRECATED: use /api/worldrestart
router.post('/restart', async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({ success: false, message: '/api/tiles/restart is deprecated - use /api/worldrestart' });
});

// GET /api/tiles/seed - Get current world seed
router.get('/seed', (_req: Request, res: Response): void => {
    res.json({
        seed: worldSeed,
        isInitialized: worldSeed !== null
    });
});

export default router;
