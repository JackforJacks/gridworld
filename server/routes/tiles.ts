// Tiles API Route - READ-ONLY endpoint
// Tile generation is handled exclusively by /api/worldrestart
import express, { Request, Response } from 'express';
import serverConfig from '../config/server';
// Storage removed - all data in Rust ECS
import Hexasphere from '../../src/core/hexasphere/HexaSphere';

// __dirname is available in CommonJS mode (our server target)

const router: express.Router = express.Router();

// Helper: parse float with fallback
function parseParam(val: unknown, fallback: number): number {
    const n = parseFloat(String(val));
    return isNaN(n) ? fallback : n;
}

// Store a consistent world seed for persistent tile generation
let worldSeed: number | null = null;

// Cache for Hexasphere geometry (expensive to create with high subdivisions)
interface HexasphereCache {
    hexasphere: InstanceType<typeof Hexasphere> | null;
    radius: number;
    subdivisions: number;
    tileWidthRatio: number;
}
let hexasphereCache: HexasphereCache = {
    hexasphere: null,
    radius: 0,
    subdivisions: 0,
    tileWidthRatio: 0
};

/**
 * Get or create cached Hexasphere instance
 * Reuses cached instance if params match, otherwise creates new one
 */
function getCachedHexasphere(radius: number, subdivisions: number, tileWidthRatio: number): InstanceType<typeof Hexasphere> {
    // Check if cache is valid
    if (hexasphereCache.hexasphere &&
        hexasphereCache.radius === radius &&
        hexasphereCache.subdivisions === subdivisions &&
        hexasphereCache.tileWidthRatio === tileWidthRatio) {
        return hexasphereCache.hexasphere;
    }

    // Create new hexasphere and cache it
    console.log(`[tiles] Creating Hexasphere (r=${radius}, s=${subdivisions}, w=${tileWidthRatio})...`);
    const startTime = Date.now();
    const hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);
    console.log(`[tiles] Hexasphere created in ${Date.now() - startTime}ms with ${hexasphere.tiles.length} tiles`);

    // Update cache
    hexasphereCache = {
        hexasphere,
        radius,
        subdivisions,
        tileWidthRatio
    };

    return hexasphere;
}

/**
 * Clear the hexasphere cache (call after world restart)
 */
export function clearHexasphereCache(): void {
    hexasphereCache = {
        hexasphere: null,
        radius: 0,
        subdivisions: 0,
        tileWidthRatio: 0
    };
}

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

// GET /api/tiles
// READ-ONLY endpoint - returns MINIMAL tile data for initial rendering
// Only includes: id, boundary, centerPoint, terrainType, biome
// Detailed data (fertility) fetched via GET /api/tiles/:id
router.get('/', async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    // If client requests regeneration, redirect them to the proper endpoint
    if (req.query.regenerate === 'true' || req.query.t) {
        res.status(400).json({
            error: 'Tile regeneration via /api/tiles is deprecated',
            message: 'Use POST /api/worldrestart with { "confirm": "DELETE_ALL_DATA" } instead',
            hint: 'This endpoint is now read-only'
        });
        return;
    }

    try {
        // Parse hexasphere params for geometry only
        const radius = parseParam(req.query.radius, parseFloat(process.env.HEXASPHERE_RADIUS || '30'));
        const subdivisions = parseParam(req.query.subdivisions, parseFloat(process.env.HEXASPHERE_SUBDIVISIONS || '3'));
        const tileWidthRatio = parseParam(req.query.tileWidthRatio, parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO || '1'));

        // Use cached hexasphere for geometry (boundary points, neighbor IDs)
        const hexasphere = getCachedHexasphere(radius, subdivisions, tileWidthRatio);

        // Get world seed (required for deterministic tile generation)
        // Always reload from environment to catch seed changes from world restart
        loadWorldSeed();

        if (!worldSeed) {
            res.status(503).json({
                error: 'World not initialized',
                message: 'No world seed found. Call POST /api/worldrestart to initialize the world.'
            });
            return;
        }

        // Import terrain calculation module
        const { calculateTileProperties } = require('../services/terrain');

        // Build MINIMAL tile response - only what's needed for rendering
        // OPTIMIZED: Use arrays instead of objects, round to 4 decimal places
        const round4 = (n: number) => Math.round(n * 10000) / 10000;

        const tiles = hexasphere.tiles.map(tile => {
            const props = tile.getProperties ? tile.getProperties() : tile;
            const tileId = props.id ?? 0;

            const centerPoint = tile.centerPoint;
            const x = centerPoint?.x || 0;
            const y = centerPoint?.y || 0;
            const z = centerPoint?.z || 0;

            // Get geometry from hexasphere (required for rendering)
            // Use compact array format: [x,y,z] instead of {x,y,z}
            const result: Record<string, unknown> = {
                id: tileId,
                boundary: tile.boundary ? tile.boundary.map(p => [round4(p.x), round4(p.y), round4(p.z)]) : [],
                centerPoint: [round4(x), round4(y), round4(z)]
            };

            // Calculate terrain/biome on-the-fly from seed (deterministic)
            const tileProps = calculateTileProperties(x, y, z, worldSeed);
            result.terrainType = tileProps.terrainType;
            result.biome = tileProps.biome;
            // Note: fertility NOT included - fetch via /api/tiles/:id

            return result;
        });

        const elapsed = Date.now() - startTime;
        if (serverConfig.verboseLogs) {
            console.log(`[API /api/tiles] Returned ${tiles.length} minimal tiles in ${elapsed}ms`);
        }

        res.json({ tiles });
    } catch (err: unknown) {
        const error = err as Error;
        res.status(500).json({ error: 'Failed to fetch tiles', details: error.message });
    }
});

// GET /api/tiles/seed - Get current world seed
// NOTE: Must be defined BEFORE /:id to avoid being caught by that route
router.get('/seed', (_req: Request, res: Response): void => {
    res.json({
        seed: worldSeed,
        isInitialized: worldSeed !== null
    });
});

// GET /api/tiles/state - Lightweight endpoint returning ONLY tile state (no geometry)
// Client generates geometry locally, this provides: terrainType, biome
// Keyed by tile ID for efficient merging with client-generated hexasphere
// NOTE: Must be defined BEFORE /:id to avoid being caught by that route
router.get('/state', async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
        // Get world seed
        // Always reload from environment to catch seed changes from world restart
        loadWorldSeed();

        if (!worldSeed) {
            res.status(503).json({
                error: 'World not initialized',
                message: 'No world seed found. Call POST /api/worldrestart to initialize the world.'
            });
            return;
        }

        // Get hexasphere params
        const radius = parseParam(req.query.radius, parseFloat(process.env.HEXASPHERE_RADIUS || '30'));
        const subdivisions = parseParam(req.query.subdivisions, parseFloat(process.env.HEXASPHERE_SUBDIVISIONS || '3'));
        const tileWidthRatio = parseParam(req.query.tileWidthRatio, parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO || '1'));

        const hexasphere = getCachedHexasphere(radius, subdivisions, tileWidthRatio);
        const { calculateTileProperties } = require('../services/terrain');

        // Build compact tile state map: { tileId: { t: terrainType, b: biome } }
        const tileState: Record<string, { t: string; b: string | null }> = {};

        for (const tile of hexasphere.tiles) {
            const props = tile.getProperties ? tile.getProperties() : tile;
            const tileId = props.id ?? 0;

            const centerPoint = tile.centerPoint;
            const x = centerPoint?.x || 0;
            const y = centerPoint?.y || 0;
            const z = centerPoint?.z || 0;

            // Calculate terrain/biome on-the-fly from seed
            const tileProps = calculateTileProperties(x, y, z, worldSeed);
            tileState[tileId.toString()] = {
                t: tileProps.terrainType,
                b: tileProps.biome
            };
        }

        const elapsed = Date.now() - startTime;
        if (serverConfig.verboseLogs) {
            console.log(`[API /api/tiles/state] Returned ${Object.keys(tileState).length} tile states in ${elapsed}ms`);
        }

        res.json({
            count: Object.keys(tileState).length,
            state: tileState
        });
    } catch (err: unknown) {
        const error = err as Error;
        res.status(500).json({ error: 'Failed to fetch tile state', details: error.message });
    }
});

// POST /api/tiles/restart - DEPRECATED: use /api/worldrestart
// NOTE: Must be defined BEFORE /:id to avoid being caught by that route
router.post('/restart', async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({ success: false, message: '/api/tiles/restart is deprecated - use /api/worldrestart' });
});

// GET /api/tiles/:id - Get detailed data for a single tile (on-demand)
// Includes: terrain, biome, fertility
// NOTE: This MUST be the last GET route as it matches any path segment
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const tileId = parseInt(req.params.id);

    try {
        // Get world seed
        // Always reload from environment to catch seed changes from world restart
        loadWorldSeed();

        if (!worldSeed) {
            res.status(503).json({ error: 'World not initialized', message: 'No world seed' });
            return;
        }

        // Get hexasphere to find tile center
        const radius = parseFloat(process.env.HEXASPHERE_RADIUS || '30');
        const subdivisions = parseFloat(process.env.HEXASPHERE_SUBDIVISIONS || '3');
        const tileWidthRatio = parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO || '1');

        const hexasphere = getCachedHexasphere(radius, subdivisions, tileWidthRatio);
        const tile = hexasphere.tiles.find(t => {
            const props = t.getProperties ? t.getProperties() : t;
            return (props.id ?? 0) === tileId;
        });

        if (!tile) {
            res.status(404).json({ error: 'Tile not found', tileId });
            return;
        }

        const centerPoint = tile.centerPoint;
        const x = centerPoint?.x || 0;
        const y = centerPoint?.y || 0;
        const z = centerPoint?.z || 0;

        // Calculate terrain/biome/fertility on-the-fly from seed
        const { calculateTileProperties } = require('../services/terrain');
        const tileProps = calculateTileProperties(x, y, z, worldSeed);

        const elapsed = Date.now() - startTime;
        if (serverConfig.verboseLogs) {
            console.log(`[API /api/tiles/${tileId}] Returned detailed tile in ${elapsed}ms`);
        }

        res.json({
            id: tileId,
            terrainType: tileProps.terrainType,
            biome: tileProps.biome,
            fertility: tileProps.fertility
        });
    } catch (err: unknown) {
        const error = err as Error;
        res.status(500).json({ error: 'Failed to fetch tile details', details: error.message });
    }
});

export default router;
