/**
 * System Routes - Health, memory, and system monitoring endpoints
 */
import express, { Request, Response, Router } from 'express';
import memoryTracker from '../services/memoryTracker';

// Try to load Rust simulation (optional dependency)
let rustSim: {
    runBenchmark: (pop: number, ticks: number) => { totalMs: number; perTickMs: number; finalPopulation: number };
} | null = null;

try {
    rustSim = require('@gridworld/simulation');
} catch {
    console.log('⚙️ Rust simulation not available (run `cd simulation && npm run build`)');
}

const router: Router = express.Router();

/**
 * GET /api/system/memory
 * Get current memory usage statistics
 */
router.get('/memory', (req: Request, res: Response) => {
    try {
        const stats = memoryTracker.getStats();
        res.json({
            success: true,
            data: stats,
        });
    } catch (error: unknown) {
        console.error('Error getting memory stats:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * GET /api/system/memory/history
 * Get memory usage history with peak and average values
 */
router.get('/memory/history', (req: Request, res: Response) => {
    try {
        const history = memoryTracker.getHistory();
        res.json({
            success: true,
            data: history,
        });
    } catch (error: unknown) {
        console.error('Error getting memory history:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * POST /api/system/gc
 * Trigger garbage collection (requires --expose-gc flag)
 */
router.post('/gc', (req: Request, res: Response) => {
    try {
        const triggered = memoryTracker.forceGC();
        if (triggered) {
            const statsAfter = memoryTracker.getStats();
            res.json({
                success: true,
                message: 'Garbage collection triggered',
                memoryAfter: statsAfter,
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Garbage collection not available. Start Node.js with --expose-gc flag.',
            });
        }
    } catch (error: unknown) {
        console.error('Error triggering GC:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * GET /api/system/health
 * Basic health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
    const stats = memoryTracker.getStats();
    res.json({
        success: true,
        status: 'healthy',
        uptime: stats.uptimeSeconds,
        memory: {
            heapUsed: stats.formatted.heapUsed,
            heapTotal: stats.formatted.heapTotal,
            heapUsagePercent: stats.heapUsagePercent,
        },
        timestamp: Date.now(),
    });
});

/**
 * GET /api/system/rust
 * Get Rust simulation engine status and memory estimate
 */
router.get('/rust', (req: Request, res: Response) => {
    if (!rustSim) {
        res.json({
            success: true,
            data: { available: false },
        });
        return;
    }
    
    try {
        // Quick benchmark: 10K population, 10 ticks
        const result = rustSim.runBenchmark(10000, 10);
        // Estimate memory: ~200 bytes per entity
        const memoryBytes = result.finalPopulation * 200;
        res.json({
            success: true,
            data: {
                available: true,
                memoryBytes,
                population: result.finalPopulation,
            },
        });
    } catch (error: unknown) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Rust simulation error',
        });
    }
});

export default router;
