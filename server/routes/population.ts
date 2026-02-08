// Population API Routes
import express, { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { UpdatePopulationSchema } from '../schemas';

const router: Router = express.Router();

// Get all population data
router.get('/', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const data = await populationService.getAllPopulationData();
        res.json(data);
    } catch (error: unknown) {
        next(error);
    }
});

// Update population data (growth rate)
router.post('/', validateBody(UpdatePopulationSchema), async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const { rate } = req.body;
        let responseData;

        if (rate !== undefined) {
            responseData = await populationService.updateGrowthRate(rate);
        }

        res.json(responseData);
    } catch (error: unknown) {
        next(error);
    }
});

// Save current data
router.post('/save', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        await populationService.saveData();
        res.json({
            success: true,
            message: 'Population data saved successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error: unknown) {
        next(error);
    }
});

// Get demographic population stats
router.get('/stats', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const stats = await populationService.getAllPopulationData();
        res.json(stats);
    } catch (error: unknown) {
        next(error);
    }
});

// Stop autosave at runtime
router.post('/autosave/stop', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        populationService.stopAutoSave();
        res.json({ success: true, message: 'Autosave stopped' });
    } catch (error: unknown) {
        next(error);
    }
});

// Start autosave at runtime (uses configured interval)
router.post('/autosave/start', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        populationService.startAutoSave();
        res.json({ success: true, message: 'Autosave started' });
    } catch (error: unknown) {
        next(error);
    }
});

export default router;
