// Tiles API Route
const express = require('express');
const router = express.Router();

// Import Hexasphere logic from the core (reuse existing code)
const path = require('path');
const { pathToFileURL } = require('url');

// Helper: parse float with fallback
function parseParam(val, fallback) {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
}

// Store a consistent world seed for persistent tile generation
let worldSeed = null;

// Load world seed from environment variable or use default
function loadWorldSeed() {
    console.log(`[API /api/tiles] Environment WORLD_SEED: ${process.env.WORLD_SEED}`);
    if (process.env.WORLD_SEED) {
        worldSeed = parseInt(process.env.WORLD_SEED);
        console.log(`[API /api/tiles] Using world seed from environment: ${worldSeed}`);
    } else {
        worldSeed = 12345; // Default seed
        console.log(`[API /api/tiles] Using default world seed: ${worldSeed}`);
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

    // Debug logging for high latitude tiles
    if (absLatitude > 55) {
        console.log(`[DEBUG] High latitude tile: lat=${latitude.toFixed(2)}°, absLat=${absLatitude.toFixed(2)}°, terrain=${terrainType}, y=${centerPoint.y.toFixed(3)}, r=${r.toFixed(3)}`);
    }

    // Force all land above a certain latitude to be tundra
    if (absLatitude > 60) {
        console.log(`[DEBUG] Assigning TUNDRA: lat=${latitude.toFixed(2)}°, terrain=${terrainType}`);
        return 'tundra';
    }

    // Otherwise, assign by terrain and latitude
    if (terrainType === 'mountains') {
        return 'alpine';
    } else if (absLatitude > 30) {
        // Temperate zones - mostly grassland, some plains
        return seededRandom() < 0.7 ? 'grassland' : 'plains';
    } else if (absLatitude > 15) {
        // Subtropical zones - mixed plains and grassland
        return seededRandom() < 0.5 ? 'plains' : 'grassland';
    } else {
        // Tropical zones - grassland savannas and some desert
        if (seededRandom() < 0.6) {
            return 'grassland'; // Tropical grasslands/savannas
        } else {
            return 'desert'; // Tropical deserts
        }
    }
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
    
    const seededRandom = function() {
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
            console.log(`[API /api/tiles] Generating tiles with seed: ${seed}`);
        }
        const hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);        const tiles = hexasphere.tiles.map(tile => {
            const props = tile.getProperties ? tile.getProperties() : tile;
            // Add boundary as array of {x, y, z}
            props.boundary = tile.boundary ? tile.boundary.map(p => ({ x: p.x, y: p.y, z: p.z })) : [];
            // Add centerPoint as {x, y, z}
            if (tile.centerPoint) {
                props.centerPoint = { x: tile.centerPoint.x, y: tile.centerPoint.y, z: tile.centerPoint.z };
                // Calculate biome based on latitude and terrain using seeded randomization
                props.biome = calculateBiome(tile.centerPoint, props.terrainType, seededRandom);
            } else {
                props.centerPoint = undefined;
                props.biome = null;
            }
            return props;
        });

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

        tiles.forEach(tile => {
            if (terrainCounts.hasOwnProperty(tile.terrainType)) {
                terrainCounts[tile.terrainType]++;
            }
            if (tile.biome && biomeCounts.hasOwnProperty(tile.biome)) {
                biomeCounts[tile.biome]++;
            }
        });const totalTiles = tiles.length;
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

// POST /api/tiles/restart - Generate a new world seed
router.post('/restart', (req, res) => {
    const oldSeed = worldSeed;
    worldSeed = Date.now();
    // Update environment variable for future restarts
    process.env.WORLD_SEED = worldSeed.toString();
    console.log(`[API /api/tiles/restart] World restarted - old seed: ${oldSeed}, new seed: ${worldSeed}`);
    
    res.json({ 
        success: true, 
        message: 'World restarted successfully',
        oldSeed: oldSeed,
        newSeed: worldSeed 
    });
});

// GET /api/tiles/seed - Get current world seed
router.get('/seed', (req, res) => {
    res.json({ 
        seed: worldSeed,
        isInitialized: worldSeed !== null 
    });
});

module.exports = router;
