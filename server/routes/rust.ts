// Rust Simulation API Routes
import express, { Request, Response, Router } from 'express';
import rustSimulation from '../services/rustSimulation';

const router: Router = express.Router();

// GET /api/rust/population - Get Rust simulation population count
router.get('/population', (req: Request, res: Response) => {
    try {
        const population = rustSimulation.getPopulation();
        res.json({ success: true, population });
    } catch (error: unknown) {
        console.error('Error getting Rust population:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/calendar - Get Rust simulation calendar
router.get('/calendar', (req: Request, res: Response) => {
    try {
        const calendar = rustSimulation.getCalendar();
        res.json({ success: true, calendar });
    } catch (error: unknown) {
        console.error('Error getting Rust calendar:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/status - Get full Rust simulation status
router.get('/status', (req: Request, res: Response) => {
    try {
        const population = rustSimulation.getPopulation();
        const calendar = rustSimulation.getCalendar();
        const memoryBytes = rustSimulation.getMemoryBytes();
        const demographics = rustSimulation.getDemographics();
        res.json({
            success: true,
            population,
            calendar,
            memoryMB: (memoryBytes / 1024 / 1024).toFixed(2),
            demographics
        });
    } catch (error: unknown) {
        console.error('Error getting Rust status:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// POST /api/rust/seed - Seed population
router.post('/seed', (req: Request, res: Response) => {
    try {
        const { count = 1000, tileId = 0 } = req.body;
        rustSimulation.seedPopulationOnTile(count, tileId);
        const population = rustSimulation.getPopulation();
        res.json({ success: true, population, seeded: count, tileId });
    } catch (error: unknown) {
        console.error('Error seeding Rust population:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// POST /api/rust/tick - Advance simulation
router.post('/tick', (req: Request, res: Response) => {
    try {
        const { count = 1 } = req.body;
        let result;
        if (count > 1) {
            result = rustSimulation.tickMany(count);
        } else {
            result = rustSimulation.tick();
        }
        const calendar = rustSimulation.getCalendar();
        res.json({ success: true, ...result, calendar });
    } catch (error: unknown) {
        console.error('Error ticking Rust simulation:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/demographics - Full demographics snapshot
router.get('/demographics', (req: Request, res: Response) => {
    try {
        const demographics = rustSimulation.getDemographics();
        res.json({ success: true, ...demographics });
    } catch (error: unknown) {
        console.error('Error getting Rust demographics:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/tiles - Population count per tile
router.get('/tiles', (req: Request, res: Response) => {
    try {
        const tiles = rustSimulation.getPopulationByTile();
        const total = tiles.reduce((sum, t) => sum + t.count, 0);
        res.json({ success: true, total, tileCount: tiles.length, tiles });
    } catch (error: unknown) {
        console.error('Error getting Rust tile populations:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/tiles/:tileId - Population count for a specific tile
router.get('/tiles/:tileId', (req: Request, res: Response) => {
    try {
        const tileId = parseInt(req.params.tileId, 10);
        if (isNaN(tileId)) {
            res.status(400).json({ success: false, error: 'Invalid tile ID' });
            return;
        }
        const population = rustSimulation.getTilePopulation(tileId);
        res.json({ success: true, tileId, population });
    } catch (error: unknown) {
        console.error('Error getting Rust tile population:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// POST /api/rust/reset - Reset simulation
router.post('/reset', (req: Request, res: Response) => {
    try {
        rustSimulation.reset();
        res.json({ success: true, population: 0 });
    } catch (error: unknown) {
        console.error('Error resetting Rust simulation:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// ============================================================================
// Event Log Routes (Phase 2)
// ============================================================================

// GET /api/rust/events - Get all events
router.get('/events', (req: Request, res: Response) => {
    try {
        const events = rustSimulation.getAllEvents();
        res.json({ success: true, count: events.length, events });
    } catch (error: unknown) {
        console.error('Error getting all events:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/events/recent - Get recent N events
router.get('/events/recent', (req: Request, res: Response) => {
    try {
        const count = parseInt((req.query.count as string) || '100', 10);
        const events = rustSimulation.getRecentEvents(count);
        res.json({ success: true, count: events.length, events });
    } catch (error: unknown) {
        console.error('Error getting recent events:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/events/type/:eventType - Get events by type
router.get('/events/type/:eventType', (req: Request, res: Response) => {
    try {
        const { eventType } = req.params;
        const events = rustSimulation.getEventsByType(eventType);
        res.json({ success: true, eventType, count: events.length, events });
    } catch (error: unknown) {
        console.error('Error getting events by type:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/events/range - Get events by date range
router.get('/events/range', (req: Request, res: Response) => {
    try {
        const startYear = parseInt((req.query.startYear as string) || '4000', 10);
        const endYear = parseInt((req.query.endYear as string) || '5000', 10);
        const events = rustSimulation.getEventsByDateRange(startYear, endYear);
        res.json({ success: true, startYear, endYear, count: events.length, events });
    } catch (error: unknown) {
        console.error('Error getting events by range:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/events/count - Get total event count
router.get('/events/count', (req: Request, res: Response) => {
    try {
        const count = rustSimulation.getEventCount();
        res.json({ success: true, count });
    } catch (error: unknown) {
        console.error('Error getting event count:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// GET /api/rust/events/count/:eventType - Count events by type in range
router.get('/events/count/:eventType', (req: Request, res: Response) => {
    try {
        const { eventType } = req.params;
        const startYear = parseInt((req.query.startYear as string) || '4000', 10);
        const endYear = parseInt((req.query.endYear as string) || '5000', 10);
        const count = rustSimulation.countEventsByType(eventType, startYear, endYear);
        res.json({ success: true, eventType, startYear, endYear, count });
    } catch (error: unknown) {
        console.error('Error counting events by type:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// DELETE /api/rust/events - Clear event log
router.delete('/events', (req: Request, res: Response) => {
    try {
        rustSimulation.clearEventLog();
        res.json({ success: true, message: 'Event log cleared' });
    } catch (error: unknown) {
        console.error('Error clearing event log:', error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

export default router;
