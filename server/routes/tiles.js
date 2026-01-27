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
        console.log(`[API /api/tiles] Regenerating world - old seed: ${worldSeed}, new seed: ${newSeed}`);
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

        // If regenerating, always persist tiles and reinitialize lands
        if (isRegenerating) {
            const regenStartTime = Date.now();
            if (serverConfig.verboseLogs) console.log('[API /api/tiles] Regenerating tiles and lands...');

            // Clear and populate tiles table
            await pool.query('TRUNCATE TABLE tiles RESTART IDENTITY CASCADE');
            await pool.query('TRUNCATE TABLE tiles_lands RESTART IDENTITY CASCADE');

            // BATCH INSERT - prepare all tile data first
            const tileValues = [];
            const tileParams = [];
            let paramIndex = 1;
            
            for (const tile of hexasphere.tiles) {
                const props = tile.getProperties ? tile.getProperties() : tile;
                const centerPoint = tile.centerPoint ? { x: tile.centerPoint.x, y: tile.centerPoint.y, z: tile.centerPoint.z } : null;
                const biome = (centerPoint && props.isLand) ? calculateBiome(tile.centerPoint, props.terrainType, seededRandom) : null;
                const fertility = calculateFertility(biome, props.terrainType, seededRandom);
                const isHabitableFlag = (props.Habitable === 'yes' && biome !== 'tundra' && biome !== 'desert' && biome !== 'alpine');
                
                tileValues.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5}, $${paramIndex+6}, $${paramIndex+7}, $${paramIndex+8}, $${paramIndex+9}, $${paramIndex+10}, $${paramIndex+11}, $${paramIndex+12})`);
                tileParams.push(
                    props.id,
                    centerPoint?.x || 0,
                    centerPoint?.y || 0,
                    centerPoint?.z || 0,
                    props.latitude || 0,
                    props.longitude || 0,
                    props.terrainType,
                    props.isLand,
                    isHabitableFlag,
                    JSON.stringify(tile.boundary ? tile.boundary.map(p => ({ x: p.x, y: p.y, z: p.z })) : []),
                    JSON.stringify(props.neighborIds || []),
                    biome,
                    fertility
                );
                paramIndex += 13;
            }

            // Single batch insert for all tiles
            if (tileValues.length > 0) {
                await pool.query(`
                    INSERT INTO tiles (id, center_x, center_y, center_z, latitude, longitude, terrain_type, is_land, is_habitable, boundary_points, neighbor_ids, biome, fertility)
                    VALUES ${tileValues.join(', ')}
                    ON CONFLICT (id) DO UPDATE SET
                        center_x = EXCLUDED.center_x, center_y = EXCLUDED.center_y, center_z = EXCLUDED.center_z,
                        latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, terrain_type = EXCLUDED.terrain_type,
                        is_land = EXCLUDED.is_land, is_habitable = EXCLUDED.is_habitable, boundary_points = EXCLUDED.boundary_points,
                        neighbor_ids = EXCLUDED.neighbor_ids, biome = EXCLUDED.biome, fertility = EXCLUDED.fertility,
                        updated_at = CURRENT_TIMESTAMP
                `, tileParams);
            }

            if (serverConfig.verboseLogs) console.log(`[API /api/tiles] Persisted ${hexasphere.tiles.length} tiles to database (batch insert)`);

            // Now initialize tiles_lands for eligible tiles - BATCH INSERT
            const eligibleTiles = await pool.query(`
                SELECT id, biome, terrain_type FROM tiles
                WHERE terrain_type NOT IN ('ocean', 'mountains')
                  AND (biome IS NULL OR biome NOT IN ('desert', 'tundra'))
            `);

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

            // Build all land values in memory first, then batch insert
            const landValues = [];
            const landParams = [];
            let landParamIndex = 1;
            const BATCH_SIZE = 5000; // Insert in chunks to avoid query size limits

            for (const tile of eligibleTiles.rows) {
                const rng = mulberry32(tile.id);
                const dist = getLandTypeDistribution(rng);
                let landTypes = [];
                landTypes = landTypes.concat(Array(dist.wasteland).fill('wasteland'));
                landTypes = landTypes.concat(Array(dist.forest).fill('forest'));
                landTypes = landTypes.concat(Array(100 - landTypes.length).fill('cleared'));

                for (let i = landTypes.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [landTypes[i], landTypes[j]] = [landTypes[j], landTypes[i]];
                }

                for (let chunk_index = 0; chunk_index < 100; chunk_index++) {
                    landValues.push(`($${landParamIndex}, $${landParamIndex+1}, $${landParamIndex+2}, $${landParamIndex+3})`);
                    landParams.push(tile.id, chunk_index, landTypes[chunk_index], landTypes[chunk_index] === 'cleared');
                    landParamIndex += 4;
                    
                    // Insert in batches to avoid query size limits
                    if (landValues.length >= BATCH_SIZE) {
                        await pool.query(
                            `INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared) VALUES ${landValues.join(', ')} ON CONFLICT DO NOTHING`,
                            landParams
                        );
                        landValues.length = 0;
                        landParams.length = 0;
                        landParamIndex = 1;
                    }
                }
            }
            
            // Insert remaining land values
            if (landValues.length > 0) {
                await pool.query(
                    `INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared) VALUES ${landValues.join(', ')} ON CONFLICT DO NOTHING`,
                    landParams
                );
            }

            const regenElapsed = Date.now() - regenStartTime;
            console.log(`⏱️ [API /api/tiles] Regenerated ${hexasphere.tiles.length} tiles + ${eligibleTiles.rows.length * 100} land chunks in ${regenElapsed}ms`);

            // Village seeding is now performed after population initialization (client-driven)
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

            // --- Fetch persisted tile data from database ---
            try {
                const { rows: dbTiles } = await pool.query(
                    'SELECT biome, fertility FROM tiles WHERE id = $1',
                    [props.id]
                );
                if (dbTiles.length > 0) {
                    // Use persisted data from database
                    props.biome = dbTiles[0].biome;
                    props.fertility = dbTiles[0].fertility;
                } else {
                    // Fallback to calculated values (should rarely happen)
                    props.biome = calculateBiome(tile.centerPoint, props.terrainType, seededRandom);
                    props.fertility = calculateFertility(props.biome, props.terrainType, seededRandom);
                }

                // Recompute Habitable: tundra, desert, and alpine should not be considered habitable even if terrain type suggests so
                try {
                    props.Habitable = ((props.terrainType === 'flats' || props.terrainType === 'hills') && props.biome !== 'tundra' && props.biome !== 'desert' && props.biome !== 'alpine') ? 'yes' : 'no';
                } catch (e) {
                    props.Habitable = (props.terrainType === 'flats' || props.terrainType === 'hills') ? 'yes' : 'no';
                }
            } catch (e) {
                console.error(`[ERROR] Failed to fetch tile data for tile ${props.id}:`, e.message);
                // Fallback to calculated values
                props.biome = calculateBiome(tile.centerPoint, props.terrainType, seededRandom);
                props.fertility = calculateFertility(props.biome, props.terrainType, seededRandom);
            }

            // --- Fetch tiles_lands for this tile ---
            try {
                const { rows: lands } = await pool.query(`
                    SELECT tl.chunk_index, tl.land_type, tl.cleared, tl.owner_id,
                           v.id AS village_id, v.name AS village_name, v.housing_slots, v.housing_capacity,
                           v.food_stores, v.food_capacity, v.food_production_rate, v.last_food_update
                    FROM tiles_lands tl
                    LEFT JOIN villages v ON v.tile_id = tl.tile_id AND v.land_chunk_index = tl.chunk_index
                    WHERE tl.tile_id = $1
                    ORDER BY tl.chunk_index
                `, [props.id]);
                props.lands = lands;

                // Update food production for villages on this tile
                const villageIds = lands
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
