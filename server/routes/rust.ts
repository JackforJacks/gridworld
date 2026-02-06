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
        res.json({
            success: true,
            population,
            calendar,
            memoryMB: (memoryBytes / 1024 / 1024).toFixed(2)
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
        if (count > 1) {
            rustSimulation.tickMany(count);
        } else {
            rustSimulation.tick();
        }
        const population = rustSimulation.getPopulation();
        const calendar = rustSimulation.getCalendar();
        res.json({ success: true, population, calendar });
    } catch (error: unknown) {
        console.error('Error ticking Rust simulation:', error);
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

export default router;
