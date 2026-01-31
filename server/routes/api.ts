// Main API Routes
import express, { Request, Response, Router } from 'express';
import http from 'http';

// Import route modules
import populationRoutes from './population';
import tilesRoutes from './tiles';
import calendarRoutes from './calendar';
import dbRoutes from './db';
import statisticsRoutes from './statistics';
import DatabaseService from '../services/databaseService';
import pool from '../config/database';
import StateManager from '../services/stateManager';
import storage from '../services/storage';
import serverConfig from '../config/server';

// Helper to safely extract error message
function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

// Interface for village seed result
interface VillageSeedResult {
    created?: number;
    [key: string]: unknown;
}

const router: Router = express.Router();
const dbService = new DatabaseService();

// Use route modules
router.use('/population', populationRoutes);
router.use('/tiles', tilesRoutes);
router.use('/calendar', calendarRoutes);
router.use('/db', dbRoutes);
router.use('/statistics', statisticsRoutes);

// POST /api/save - Save game state from Redis to PostgreSQL
router.post('/save', async (req: Request, res: Response) => {
    try {
        if (!StateManager.isRedisAvailable()) {
            console.warn('⚠️ Save attempted but Redis is not available');
            return res.status(503).json({ success: false, error: 'Redis not available - cannot save in-memory state' });
        }

        const result = await StateManager.saveToDatabase();
        res.json({ success: true, ...result });
    } catch (error: unknown) {
        console.error('Error saving game:', error);
        res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
});

// POST /api/sync - Force full Redis sync from PostgreSQL
router.post('/sync', async (req: Request, res: Response) => {
    try {
        const result = await StateManager.loadFromDatabase();
        res.json({ success: true, ...result });
    } catch (error: unknown) {
        console.error('Error forcing sync:', error);
        res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
});

// POST /api/population/sync - Force population-only redis sync from Postgres
import PopulationState from '../services/populationState';
router.post('/population/sync', async (req: Request, res: Response) => {
    try {
        console.log('🔄 Forced population sync request received...');
        const result = await PopulationState.syncFromPostgres();
        res.json({ success: true, ...result });
    } catch (error: unknown) {
        console.error('Error forcing population sync:', error);
        res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
});

// GET /api/state - Get current Redis state status
router.get('/state', async (req: Request, res: Response) => {
    try {
        const villages = await StateManager.getAllVillages();
        const people = await StateManager.getAllPeople();
        res.json({
            initialized: StateManager.isInitialized(),
            villages: villages.length,
            people: people.length,
            totalFoodStores: villages.reduce((sum: number, v: { food_stores?: number }) => sum + (v.food_stores || 0), 0).toFixed(0)
        });
    } catch (error: unknown) {
        console.error('Error getting state:', error);
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

// REMOVED: /api/metrics endpoint (lightweight Redis metrics) removed on 2026-01-28
// This endpoint was replaced/removed as part of removing monitoring artifacts from the repository.

// Helper: internal GET request to this server
async function selfGet(path: string): Promise<Record<string, unknown>> {
    const port = process.env.PORT || 3000;
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port, path, method: 'GET', timeout: 300000 }, (resp) => {
            let data = '';
            resp.on('data', (chunk: Buffer | string) => { data += chunk; });
            resp.on('end', () => {
                const statusCode = resp.statusCode ?? 0;
                if (statusCode >= 200 && statusCode < 300) {
                    try {
                        resolve(JSON.parse(data || '{}'));
                    } catch (e: unknown) {
                        console.warn('[selfGet] Failed to parse JSON response:', (e as Error)?.message ?? e);
                        resolve({});
                    }
                } else {
                    reject(new Error(`Status ${statusCode}`));
                }
            });
        });
        req.on('error', (err: Error) => {
            console.error(`[selfGet ${path}] error:`, err.message || err);
            reject(err);
        });
        req.on('timeout', () => {
            const err = new Error('timeout');
            console.error(`[selfGet ${path}] timeout`);
            req.destroy(err);
            reject(err);
        });
        req.end();
    });
}

// Config endpoint to expose environment variables
router.get('/config', (req: Request, res: Response) => {
    res.json({
        hexasphere: {
            radius: parseFloat(process.env.HEXASPHERE_RADIUS || '30'),
            subdivisions: parseFloat(process.env.HEXASPHERE_SUBDIVISIONS || '3'),
            tileWidthRatio: parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO || '1')
        }
    });
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        server: 'GridWorld',
        version: '2.0.0'
    });
});

// API info endpoint
router.get('/', (req: Request, res: Response) => {
    res.json({
        name: 'GridWorld API',
        version: '2.0.0',
        endpoints: {
            health: '/api/health',
            population: '/api/population',
            tiles: '/api/tiles',
            'population.get': 'GET /api/population',
            'population.update': 'POST /api/population',
            'population.initialize': 'POST /api/population/initialize',
            'population.reset': 'GET /api/population/reset'
        }
    });
});

// POST /api/worldrestart - Unified restart endpoint (tiles + population + villages + calendar reset)
// REQUIRES explicit confirmation to prevent accidental data loss
router.post('/worldrestart', async (req: Request, res: Response) => {
    const startTime = Date.now();

    // SAFEGUARD: Require explicit confirmation to prevent accidental restarts
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE_ALL_DATA') {
        console.warn('⚠️ [worldrestart] Blocked restart attempt without confirmation');
        return res.status(400).json({
            success: false,
            message: 'World restart requires explicit confirmation. Send { "confirm": "DELETE_ALL_DATA" } in request body.',
            warning: 'This will DELETE all population data permanently!'
        });
    }

    if (serverConfig.verboseLogs) console.log('🔴 [worldrestart] CONFIRMED - Starting world restart (all data will be wiped)...');

    const populationService = req.app.locals.populationService;
    if (!populationService) {
        return res.status(500).json({ success: false, message: 'Population service unavailable' });
    }

    let calendarState: unknown = null;
    let wasRunning = false;
    let seedResult: VillageSeedResult | null = null;

    try {
        // Mark restarting so tick handlers skip processing
        PopulationState.isRestarting = true;

        // Generate a new random seed for world restart to create different environments
        const newWorldSeed = Math.floor(Math.random() * 2147483647);
        process.env.WORLD_SEED = newWorldSeed.toString();
        if (serverConfig.verboseLogs) console.log(`🎲 [worldrestart] Generated new random world seed: ${newWorldSeed}`);

        // Always regenerate tiles with new seed for truly random environments
        let stepStart = Date.now();
        try {
            await selfGet('/api/tiles?regenerate=true&silent=1');
            if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Tiles regeneration with new seed: ${Date.now() - stepStart}ms`);
        } catch (regenErr: unknown) {
            console.error('[API /api/worldrestart] Tile regeneration failed:', getErrorMessage(regenErr));
            throw regenErr;
        }

        // Pause calendar during world restart to prevent tick events
        const calendarService = req.app.locals.calendarService;
        if (calendarService && calendarService.state && calendarService.state.isRunning) {
            wasRunning = true;
            if (serverConfig.verboseLogs) console.log('⏸️ Pausing calendar for world restart...');
            calendarService.stop();
        }

        // Skip the old tile regeneration logic since we always regenerate now
        // Reset population and reinitialize on habitable tiles
        stepStart = Date.now();
        await populationService.resetPopulation({ preserveDatabase: false });
        if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Population reset (full wipe): ${Date.now() - stepStart}ms`);

        stepStart = Date.now();
        // Select habitable tiles that also have cleared lands from Redis
        const habitableIds: number[] = [];
        try {
            const tileData = await storage.hgetall('tile');
            const landsData = await storage.hgetall('tile:lands');

            if (tileData && landsData) {
                for (const [tileId, tileJson] of Object.entries(tileData)) {
                    const tile = JSON.parse(tileJson as string);
                    if (tile.is_habitable) {
                        // Check if this tile has cleared lands
                        const landsJson = landsData[tileId];
                        if (landsJson) {
                            const lands = JSON.parse(landsJson as string);
                            const hasClearedLand = lands.some((land: { cleared?: boolean }) => land.cleared);
                            if (hasClearedLand) {
                                habitableIds.push(parseInt(tileId));
                            }
                        }
                    }
                }
            }
        } catch (e: unknown) {
            console.error('[API /api/worldrestart] Failed to get habitable tiles from Redis:', getErrorMessage(e));
        }

        if (habitableIds.length > 0) {
            await populationService.initializeTilePopulations(habitableIds, { preserveDatabase: false, forceAll: true });
        }
        if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Population initialization: ${Date.now() - stepStart}ms`);

        // Seed villages using robust VillageManager (non-fatal)
        stepStart = Date.now();
        try {
            // Use VillageManager for robust village creation and residency assignment
            const VillageManager = require('../services/villageSeeder/villageManager');
            seedResult = await VillageManager.ensureVillagesForPopulatedTiles({ force: true });
            if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Village seeding (VillageManager): ${Date.now() - stepStart}ms`);
        } catch (seedErr: unknown) {
            console.warn('[API /api/worldrestart] Village seeding failed:', getErrorMessage(seedErr));
        }

        // Broadcast villages to clients from storage
        try {
            const villages = await StateManager.getAllVillages();
            if (req.app.locals.io && villages.length > 0) {
                req.app.locals.io.emit('villagesUpdated', villages);
                if (serverConfig.verboseLogs) console.log(`[API /api/worldrestart] Broadcasted ${villages.length} villages to clients`);
            }
        } catch (villageErr: unknown) {
            console.warn('[API /api/worldrestart] Village broadcast failed:', getErrorMessage(villageErr));
        }

        // Reset calendar to Year 4000 and reset internal counters
        try {
            const calendarService = req.app.locals.calendarService;
            if (calendarService && typeof calendarService.setDate === 'function') {
                calendarService.setDate(1, 1, 4000);
                if (calendarService.state) {
                    if (typeof calendarService.calculateTotalDays === 'function') {
                        calendarService.state.totalDays = calendarService.calculateTotalDays(4000, 1, 1);
                    } else {
                        calendarService.state.totalDays = 0;
                    }
                    calendarService.state.totalTicks = 0;
                    calendarService.state.startTime = Date.now();
                    calendarService.state.lastTickTime = Date.now();
                }
                if (typeof calendarService.saveStateToDB === 'function') {
                    try { await calendarService.saveStateToDB(); } catch (e: unknown) { console.warn('[worldrestart] Failed to save calendar state to DB:', (e as Error)?.message ?? e); }
                }
                calendarState = calendarService.getState();
                if (calendarService.io && typeof calendarService.io.emit === 'function') {
                    calendarService.io.emit('calendarState', calendarState);
                    calendarService.io.emit('calendarDateSet', calendarState);
                }
                if (serverConfig.verboseLogs) console.log('[API /api/worldrestart] Calendar reset to Year 4000');
            }
        } catch (calErr: unknown) {
            console.warn('[API /api/worldrestart] Calendar reset failed:', getErrorMessage(calErr));
        }

        // Broadcast population update to all clients after restart
        try {
            await populationService.broadcastUpdate('populationReset');
            if (serverConfig.verboseLogs) console.log('[API /api/worldrestart] Population update broadcasted to clients');
        } catch (broadcastErr: unknown) {
            console.warn('[API /api/worldrestart] Failed to broadcast population update:', getErrorMessage(broadcastErr));
        }

        const elapsed = Date.now() - startTime;
        const worldSeed = (process.env.WORLD_SEED || 'unknown');
        console.log(`🎲 World restarted with seed: ${worldSeed} (took ${elapsed}ms)`);

        // Clear restarting flag and resume calendar if it was running
        PopulationState.isRestarting = false;
        if (wasRunning && req.app.locals.calendarService) {
            if (serverConfig.verboseLogs) console.log('▶️ Resuming calendar after world restart...');
            req.app.locals.calendarService.start();
        }

        return res.json({ success: true, message: 'World restarted and reinitialized', newSeed: worldSeed, calendarState, elapsed, villagesSeeded: seedResult?.created ?? 0 });
    } catch (error: unknown) {
        // Clear restarting flag even on error
        PopulationState.isRestarting = false;

        const elapsed = Date.now() - startTime;
        console.error('[API /api/worldrestart] Failed:', getErrorMessage(error));

        // Resume calendar even on failure if it was running
        if (wasRunning && req.app.locals.calendarService) {
            console.log('▶️ Resuming calendar after world restart failure...');
            req.app.locals.calendarService.start();
        }

        return res.status(500).json({ success: false, message: 'World restart failed', error: getErrorMessage(error), elapsed });
    }
});

// Deprecated: /api/reset/fast has been superseded by /api/worldrestart
router.post('/reset/fast', async (req: Request, res: Response) => {
    res.status(410).json({ success: false, message: '/api/reset/fast is deprecated - use /api/worldrestart' });
});

// POST /api/reset-all - Truncate all tables dynamically
router.post('/reset-all', async (req: Request, res: Response) => {
    try {
        const result = await dbService.truncateAllTables();
        res.json({
            success: true,
            message: result.message,
            tables: result.tables,
            timestamp: new Date().toISOString()
        });
    } catch (error: unknown) {
        res.status(500).json({
            success: false,
            error: 'Failed to truncate all tables',
            details: getErrorMessage(error)
        });
    }
});

// NOTE: /statistics/* routes are now handled by the statistics router (see statisticsRoutes above)

export default router;
