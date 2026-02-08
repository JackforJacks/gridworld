// Main API Routes
import express, { Request, Response, Router } from 'express';
import http from 'http';

// Import route modules
import populationRoutes from './population';
import tilesRoutes from './tiles';
import calendarRoutes from './calendar';
import statisticsRoutes from './statistics';
import systemRoutes from './system';
import rustRoutes from './rust';
import StateManager from '../services/stateManager';
import serverConfig from '../config/server';
import { validateBody } from '../middleware/validate';
import { WorldRestartSchema } from '../schemas';
import { restartWorld } from '../services/worldRestart';

// Helper to safely extract error message
function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

const router: Router = express.Router();

// Use route modules
router.use('/population', populationRoutes);
router.use('/tiles', tilesRoutes);
router.use('/calendar', calendarRoutes);
router.use('/statistics', statisticsRoutes);
router.use('/system', systemRoutes);
router.use('/rust', rustRoutes);

// POST /api/save - Save game state
router.post('/save', async (req: Request, res: Response) => {
    try {
        const result = await StateManager.saveToDatabase();
        res.json({ success: true, ...result });
    } catch (error: unknown) {
        console.error('Error saving game:', error);
        res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
});

// POST /api/sync - Load game state
router.post('/sync', async (req: Request, res: Response) => {
    try {
        const result = await StateManager.loadFromDatabase();
        res.json({ success: true, ...result });
    } catch (error: unknown) {
        console.error('Error loading game:', error);
        res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
});

// GET /api/state - Get current state status
router.get('/state', async (req: Request, res: Response) => {
    try {
        const peopleCount = await StateManager.getPopulationCount();
        res.json({
            initialized: StateManager.isInitialized(),
            people: peopleCount,
        });
    } catch (error: unknown) {
        console.error('Error getting state:', error);
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

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
        }
    });
});

// POST /api/worldrestart - Unified restart endpoint (tiles + population + calendar reset)
import PopulationState from '../services/populationState';
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

export default router;
