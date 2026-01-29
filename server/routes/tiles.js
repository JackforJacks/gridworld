// Tiles API Route
const express = require('express');
const router = express.Router();

// Import Hexasphere logic from the core (reuse existing code)
const path = require('path');
const { pathToFileURL } = require('url');
const pool = require('../config/database');
const villageSeeder = require('../services/villageSeeder');
const villageService = require('../services/villageService');
const http = require('http');
const serverConfig = require('../config/server');
const storage = require('../services/storage');

// Helper: parse float with fallback
function parseParam(val, fallback) {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
}

// Store a consistent world seed for persistent tile generation
let worldSeed = null;

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
function calculateBiome(centerPoint, terrainType, seededRandom) {
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
function calculateFertility(biome, terrainType, seededRandom) {
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
router.get('/', async (req, res) => {
    // Parse params with environment variable defaults
    const radius = parseParam(req.query.radius, process.env.HEXASPHERE_RADIUS || 30);
    const subdivisions = parseParam(req.query.subdivisions, process.env.HEXASPHERE_SUBDIVISIONS || 3);
    const tileWidthRatio = parseParam(req.query.tileWidthRatio, process.env.HEXASPHERE_TILE_WIDTH_RATIO || 1);

    // Use existing world seed unless explicitly regenerating
    if (req.query.regenerate === 'true' || req.query.t) {
        // Only regenerate when explicitly requested
        const newSeed = req.query.t ? parseFloat(req.query.t) : Date.now();
        if (serverConfig.verboseLogs) console.log(`[API /api/tiles] Regenerating world - old seed: ${worldSeed}, new seed: ${newSeed}`);
        worldSeed = newSeed;
        // Update environment variable for future restarts
        process.env.WORLD_SEED = worldSeed.toString();
    }

    const seed = worldSeed;
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
                const isHabitableFlag = (props.Habitable === 'yes' && biome !== 'tundra' && biome !== 'desert' && biome !== 'alpine');

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

            function getLandTypeDistribution(rng) {
                const wastelandPercent = Math.floor(rng() * 31);
                const forestPercent = Math.floor(rng() * 71);
                let clearedPercent = 100 - wastelandPercent - forestPercent;
                if (clearedPercent < 0) {
                    clearedPercent = 0;
                    forestPercent = 100 - wastelandPercent;
                }
                return { wasteland: wastelandPercent, forest: forestPercent, cleared: clearedPercent };
            }

            function mulberry32(seed) {
                return function () {
                    let t = seed += 0x6D2B79F5;
                    t = Math.imul(t ^ t >>> 15, t | 1);
                    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                    return ((t ^ t >>> 14) >>> 0) / 4294967296;
                }
            }

            for (const tile of eligibleTiles) {
                const props = tile.getProperties ? tile.getProperties() : tile;
                const rng = mulberry32(props.id);
                const dist = getLandTypeDistribution(rng);
                let landTypes = [];
                landTypes = landTypes.concat(Array(dist.wasteland).fill('wasteland'));
                landTypes = landTypes.concat(Array(dist.forest).fill('forest'));
                landTypes = landTypes.concat(Array(100 - landTypes.length).fill('cleared'));

                for (let i = landTypes.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [landTypes[i], landTypes[j]] = [landTypes[j], landTypes[i]];
                }

                const landsData = [];
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
            return res.json({ success: true, regenerated: true, seed });
        }

        const tiles = await Promise.all(hexasphere.tiles.map(async tile => {
            const props = tile.getProperties ? tile.getProperties() : tile;
            // Add boundary as array of {x, y, z}
            props.boundary = tile.boundary ? tile.boundary.map(p => ({ x: p.x, y: p.y, z: p.z })) : [];
            // Add centerPoint as {x, y, z}
            if (tile.centerPoint) {
                props.centerPoint = { x: tile.centerPoint.x, y: tile.centerPoint.y, z: tile.centerPoint.z };
            } else {
                props.centerPoint = undefined;
            }

            // --- Fetch persisted tile data from Redis (only source of truth) ---
            try {
                const tileDataJson = await storage.hget('tile', props.id.toString());
                if (tileDataJson) {
                    const tileData = JSON.parse(tileDataJson);
                    // Use persisted data from Redis (only source of truth)
                    props.terrainType = tileData.terrain_type;
                    props.isLand = tileData.is_land;
                    props.biome = tileData.biome;
                    props.fertility = tileData.fertility;
                    props.Habitable = tileData.is_habitable ? 'yes' : 'no';
                }
                // If not in Redis, use calculated values from HexaSphere
            } catch (e) {
                console.error(`[ERROR] Failed to fetch tile data for tile ${props.id}:`, e.message);
            }

            // --- Fetch tiles_lands for this tile from Redis (only source of truth) ---
            try {
                const landsDataJson = await storage.hget('tile:lands', props.id.toString());
                if (landsDataJson) {
                    const landsData = JSON.parse(landsDataJson);
                    // Add village information by joining with village data
                    const villageData = await storage.hgetall('village');
                    const landsWithVillages = landsData.map(land => {
                        // Find village for this tile/chunk
                        if (villageData) {
                            for (const [villageId, villageJson] of Object.entries(villageData)) {
                                try {
                                    const village = JSON.parse(villageJson);
                                    if (village.tile_id === land.tile_id && village.land_chunk_index === land.chunk_index) {
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
                                } catch (_) {}
                            }
                        }
                        return land;
                    });
                    props.lands = landsWithVillages;
                } else {
                    props.lands = [];
                }

                // Update food production for villages on this tile
                const villageIds = props.lands
                    .filter(land => land.village_id)
                    .map(land => land.village_id)
                    .filter((id, index, arr) => arr.indexOf(id) === index); // Remove duplicates

                for (const villageId of villageIds) {
                    try {
                        await villageService.updateVillageFoodProduction(villageId);
                        await villageService.updateVillageFoodStores(villageId);
                    } catch (error) {
                        console.error(`[ERROR] Failed to update food for village ${villageId}:`, error.message);
                    }
                }
            } catch (e) {
                console.error(`[ERROR] Failed to fetch lands for tile ${props.id}:`, e.message);
                props.lands = [];
            }
            // --- End tiles_lands fetch ---
            return props;
        }));

        // Debug: Check Y coordinate range
        let minY = Infinity, maxY = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;
        let landTilesCount = 0;
        tiles.forEach(tile => {
            if (tile.centerPoint) {
                minY = Math.min(minY, tile.centerPoint.y);
                maxY = Math.max(maxY, tile.centerPoint.y);

                // Calculate latitude properly
                const r = Math.sqrt(tile.centerPoint.x * tile.centerPoint.x + tile.centerPoint.y * tile.centerPoint.y + tile.centerPoint.z * tile.centerPoint.z);
                const lat = Math.asin(tile.centerPoint.y / r) * (180 / Math.PI);
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);

                if (tile.terrainType !== 'ocean') {
                    landTilesCount++;
                }
            }
        });

        if (isRegenerating) {
            console.log(`[DEBUG] Y coordinate range: ${minY.toFixed(3)} to ${maxY.toFixed(3)}`);
            console.log(`[DEBUG] Latitude range: ${minLat.toFixed(1)}° to ${maxLat.toFixed(1)}°`);
            console.log(`[DEBUG] Total land tiles: ${landTilesCount}`);
        }        // Calculate terrain distribution for debugging
        const terrainCounts = {
            ocean: 0,
            flats: 0,
            hills: 0,
            mountains: 0
        };

        const biomeCounts = {
            tundra: 0,
            desert: 0,
            plains: 0,
            grassland: 0,
            alpine: 0
        };

        let totalFertility = 0;
        let fertileTilesCount = 0;
        let maxFertility = 0;
        let minFertility = 100;

        tiles.forEach(tile => {
            if (terrainCounts.hasOwnProperty(tile.terrainType)) {
                terrainCounts[tile.terrainType]++;
            }
            if (tile.biome && biomeCounts.hasOwnProperty(tile.biome)) {
                biomeCounts[tile.biome]++;
            }
            if (tile.fertility !== undefined && tile.fertility !== null) {
                totalFertility += tile.fertility;
                if (tile.fertility > 0) {
                    fertileTilesCount++;
                }
                maxFertility = Math.max(maxFertility, tile.fertility);
                minFertility = Math.min(minFertility, tile.fertility);
            }
        }); const totalTiles = tiles.length;
        const waterTiles = terrainCounts.ocean;
        const waterPercentage = ((waterTiles / totalTiles) * 100).toFixed(1);
        const oceanPercentage = ((terrainCounts.ocean / totalTiles) * 100).toFixed(1);

        if (isRegenerating) {
            console.log(`[API /api/tiles] Terrain Distribution (Total: ${totalTiles}):`);
            console.log(`  Ocean: ${terrainCounts.ocean} (${oceanPercentage}%)`);
            console.log(`  Flats: ${terrainCounts.flats} (${((terrainCounts.flats / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  Hills: ${terrainCounts.hills} (${((terrainCounts.hills / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  Mountains: ${terrainCounts.mountains} (${((terrainCounts.mountains / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  Total Water: ${waterTiles} (${waterPercentage}%)`);

            console.log(`[API /api/tiles] Biome Distribution:`);
            console.log(`  🏔️ Tundra: ${biomeCounts.tundra} (${((biomeCounts.tundra / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  🏜️ Desert: ${biomeCounts.desert} (${((biomeCounts.desert / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  🌾 Plains: ${biomeCounts.plains} (${((biomeCounts.plains / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  🌱 Grassland: ${biomeCounts.grassland} (${((biomeCounts.grassland / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  ⛰️ Alpine: ${biomeCounts.alpine} (${((biomeCounts.alpine / totalTiles) * 100).toFixed(1)}%)`);

            console.log(`[API /api/tiles] Fertility Statistics:`);
            const avgFertility = totalTiles > 0 ? (totalFertility / totalTiles).toFixed(1) : 0;
            const avgFertileOnly = fertileTilesCount > 0 ? (totalFertility / fertileTilesCount).toFixed(1) : 0;
            console.log(`  🌱 Fertile tiles: ${fertileTilesCount}/${totalTiles} (${((fertileTilesCount / totalTiles) * 100).toFixed(1)}%)`);
            console.log(`  📊 Average fertility (all): ${avgFertility}/100`);
            console.log(`  📊 Average fertility (fertile only): ${avgFertileOnly}/100`);
            console.log(`  📈 Fertility range: ${minFertility}-${maxFertility}`);

            console.log('[API /api/tiles] Generated tiles:', Array.isArray(tiles) ? tiles.length : tiles);
        }

        // Restore original Math.random
        Math.random = originalRandom;

        res.json({ tiles });
    } catch (err) {
        // Restore original Math.random in case of error
        Math.random = originalRandom;
        res.status(500).json({ error: 'Failed to generate tiles', details: err.message });
    }
});

// POST /api/tiles/restart - DEPRECATED: use /api/worldrestart
router.post('/restart', async (req, res) => {
    res.status(410).json({ success: false, message: '/api/tiles/restart is deprecated - use /api/worldrestart' });
});

// GET /api/tiles/seed - Get current world seed
router.get('/seed', (req, res) => {
    res.json({
        seed: worldSeed,
        isInitialized: worldSeed !== null
    });
});

module.exports = router;
