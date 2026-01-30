// Population API Routes
const express = require('express');
const router = express.Router();

const StateManager = require('../services/stateManager');

// Enforce Redis-first: all population API calls require Redis to be available
router.use((req, res, next) => {
    try {
        if (!StateManager.isRedisAvailable()) {
            return res.status(503).json({ success: false, error: 'Redis not available - population API requires Redis as the source of truth' });
        }
    } catch (e) {
        return res.status(500).json({ success: false, error: 'Server error checking storage availability' });
    }
    next();
});

// Get all population data
router.get('/', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const data = await populationService.getAllPopulationData();
        res.json(data);
    } catch (error) {
        next(error);
    }
});

// Update population data (growth rate or tile populations)
router.post('/', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const { rate, tilePopulations } = req.body;
        let responseData;

        if (typeof rate === 'number' && rate >= 0) {
            responseData = await populationService.updateGrowthRate(rate);
        }

        if (tilePopulations && typeof tilePopulations === 'object') {
            responseData = await populationService.updateTilePopulations(tilePopulations);
        }

        if (!responseData) {
            return res.status(400).json({
                success: false,
                error: 'No valid data provided',
                message: 'Please provide either "rate" (number) or "tilePopulations" (object)'
            });
        }

        res.json(responseData);
    } catch (error) {
        next(error);
    }
});

// Initialize tile populations
router.post('/initialize', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const { habitableTiles, preserveDatabase = false } = req.body || {};

        if (!habitableTiles || !Array.isArray(habitableTiles)) {
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: 'habitableTiles array is required'
            });
        }

        const responseData = await populationService.initializeTilePopulations(habitableTiles, { preserveDatabase });

        // Emit update to all clients
        res.json(responseData);
    } catch (error) {
        next(error);
    }
});

// Reset all population data
router.post('/reset', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const responseData = await populationService.resetPopulation();
        res.json({
            success: true,
            message: 'All tile populations reset',
            data: responseData
        });
    } catch (error) {
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
    } catch (error) {
        next(error);
    }
});

// Get demographic population stats (male, female, under 18, over 65)
router.get('/stats', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const stats = await populationService.getAllPopulationData();
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

// Regenerate population with new age distribution
router.post('/regenerate', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const responseData = await populationService.regeneratePopulationWithNewAgeDistribution();
        res.json({
            success: true,
            message: 'Population regenerated with new age distribution',
            data: responseData
        });
    } catch (error) {
        next(error);
    }
});

// Apply senescence (death by old age) manually
router.post('/senescence', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const responseData = await populationService.applySenescenceManually();
        res.json(responseData);
    } catch (error) {
        next(error);
    }
});

// Run integrity check (optionally repair) - ADMIN
router.post('/integrity', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const { tiles, repair = false } = req.body || {};
        // Expect tiles to be an array of tile IDs (optional)
        const options = { tiles: Array.isArray(tiles) ? tiles : null, repair: Boolean(repair) };
        const result = await populationService.runIntegrityCheck(options);
        res.json({ success: result.success, details: result.details });
    } catch (error) {
        next(error);
    }
});

// Create families for existing population
router.post('/create-families', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        const responseData = await populationService.createFamiliesForExistingPopulation();
        res.json(responseData);
    } catch (error) {
        next(error);
    }
});

// Stop autosave at runtime
router.post('/autosave/stop', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        populationService.stopAutoSave();
        res.json({ success: true, message: 'Autosave stopped' });
    } catch (error) {
        next(error);
    }
});

// Start autosave at runtime (uses configured interval)
router.post('/autosave/start', async (req, res, next) => {
    try {
        const populationService = req.app.locals.populationService;
        populationService.startAutoSave();
        res.json({ success: true, message: 'Autosave started' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
