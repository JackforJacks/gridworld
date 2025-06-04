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

// GET /api/tiles
router.get('/', async (req, res) => {
    // Parse params with environment variable defaults
    const radius = parseParam(req.query.radius, process.env.HEXASPHERE_RADIUS || 30);
    const subdivisions = parseParam(req.query.subdivisions, process.env.HEXASPHERE_SUBDIVISIONS || 3);
    const tileWidthRatio = parseParam(req.query.tileWidthRatio, process.env.HEXASPHERE_TILE_WIDTH_RATIO || 1);

    try {
        // Dynamically import Hexasphere as ESM with file:// URL
        const hexasphereUrl = pathToFileURL(path.resolve(__dirname, '../../src/core/hexasphere/HexaSphere.js'));
        const HexasphereModule = await import(hexasphereUrl.href);
        const Hexasphere = HexasphereModule.default;
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
        }); const totalTiles = tiles.length;
        const waterTiles = terrainCounts.ocean;
        const waterPercentage = ((waterTiles / totalTiles) * 100).toFixed(1);
        const oceanPercentage = ((terrainCounts.ocean / totalTiles) * 100).toFixed(1);

        console.log(`[API /api/tiles] Terrain Distribution (Total: ${totalTiles}):`);
        console.log(`  Ocean: ${terrainCounts.ocean} (${oceanPercentage}%)`);
        console.log(`  Flats: ${terrainCounts.flats} (${((terrainCounts.flats / totalTiles) * 100).toFixed(1)}%)`);
        console.log(`  Hills: ${terrainCounts.hills} (${((terrainCounts.hills / totalTiles) * 100).toFixed(1)}%)`);
        console.log(`  Mountains: ${terrainCounts.mountains} (${((terrainCounts.mountains / totalTiles) * 100).toFixed(1)}%)`);
        console.log(`  Total Water: ${waterTiles} (${waterPercentage}%)`);

        console.log('[API /api/tiles] Generated tiles:', Array.isArray(tiles) ? tiles.length : tiles);
        res.json({ tiles });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate tiles', details: err.message });
    }
});

module.exports = router;
