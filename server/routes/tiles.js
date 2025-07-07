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
    
    Math.random = function() {
        randomSeed = (randomSeed * 16807) % 2147483647;
        return (randomSeed - 1) / 2147483646;
    };

    try {
        // Dynamically import Hexasphere as ESM with file:// URL
        const hexasphereUrl = pathToFileURL(path.resolve(__dirname, '../../src/core/hexasphere/HexaSphere.js'));
        const HexasphereModule = await import(hexasphereUrl.href);
        const Hexasphere = HexasphereModule.default;
        
        if (isRegenerating) {
            console.log(`[API /api/tiles] Generating tiles with seed: ${seed}`);
        }
        const hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio); const tiles = hexasphere.tiles.map(tile => {
            const props = tile.getProperties ? tile.getProperties() : tile;
            // Add boundary as array of {x, y, z}
            props.boundary = tile.boundary ? tile.boundary.map(p => ({ x: p.x, y: p.y, z: p.z })) : [];
            // Add centerPoint as {x, y, z}
            if (tile.centerPoint) {
                props.centerPoint = { x: tile.centerPoint.x, y: tile.centerPoint.y, z: tile.centerPoint.z };
            } else {
                props.centerPoint = undefined;
            }
            return props;
        });        // Calculate terrain distribution for debugging
        const terrainCounts = {
            ocean: 0,
            flats: 0,
            hills: 0,
            mountains: 0
        };

        tiles.forEach(tile => {
            if (terrainCounts.hasOwnProperty(tile.terrainType)) {
                terrainCounts[tile.terrainType]++;
            }
        });        const totalTiles = tiles.length;
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
