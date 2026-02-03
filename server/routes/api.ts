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
import { validateBody } from '../middleware/validate';
import { WorldRestartSchema } from '../schemas';
import { restartWorld } from '../services/worldRestart';

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
        const peopleCount = await StateManager.getPopulationCount();
        res.json({
            initialized: StateManager.isInitialized(),
            villages: villages.length,
            people: peopleCount,
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
        const req = http.request({ hostname: 'localhost', port, path, method: 'GET' }, (resp) => {
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
        // Set socket timeout to 10 minutes for large operations like tile regeneration
        req.setTimeout(600000, () => {
            const err = new Error('timeout');
            console.error(`[selfGet ${path}] timeout`);
            req.destroy(err);
            reject(err);
        });
        req.on('error', (err: Error) => {
            console.error(`[selfGet ${path}] error:`, err.message || err);
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
// Uses unified WorldRestart service for clean, optimized, Redis-first restart
router.post('/worldrestart', validateBody(WorldRestartSchema), async (req: Request, res: Response) => {
    if (serverConfig.verboseLogs) {
        console.log('🔴 [worldrestart] CONFIRMED - Starting world restart...');
    }

    try {
        // Mark restarting so tick handlers skip processing
        PopulationState.isRestarting = true;

        // Use unified WorldRestart service
        const result = await restartWorld({
            context: {
                calendarService: req.app.locals.calendarService,
                io: req.app.locals.io
            }
        });

        // Clear restarting flag
        PopulationState.isRestarting = false;

        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: 'World restart failed',
                error: result.error,
                elapsed: result.elapsed
            });
        }

        // Get calendar state for response
        let calendarState = null;
        if (req.app.locals.calendarService?.getState) {
            calendarState = req.app.locals.calendarService.getState();
        }

        return res.json({
            success: true,
            message: 'World restarted and reinitialized',
            newSeed: result.seed,
            calendarState,
            elapsed: result.elapsed,
            villagesSeeded: result.villages,
            integrity: result.integrity
        });

    } catch (error: unknown) {
        // Clear restarting flag even on error
        PopulationState.isRestarting = false;

        console.error('[API /api/worldrestart] Failed:', getErrorMessage(error));
        return res.status(500).json({
            success: false,
            message: 'World restart failed',
            error: getErrorMessage(error)
        });
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
