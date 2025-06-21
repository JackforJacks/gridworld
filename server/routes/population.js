// Population API Routes
const express = require('express');
const router = express.Router();
const populationService = require('../services/populationService');

// Get all population data
router.get('/', async (req, res, next) => {
    try {
        const data = await populationService.getAllPopulationData();
        res.json(data);
    } catch (error) {
        next(error);
    }
});

// Update population data (growth rate or tile populations)
router.post('/', async (req, res, next) => {
    try {
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
        const { habitableTiles } = req.body;

        if (!habitableTiles || !Array.isArray(habitableTiles)) {
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: 'habitableTiles array is required'
            });
        }

        const responseData = await populationService.initializeTilePopulations(habitableTiles);

        // Emit update to all clients
        res.json(responseData);
    } catch (error) {
        next(error);
    }
});

// Reset all population data
router.post('/reset', async (req, res, next) => {
    try {
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
        const stats = await populationService.getAllPopulationData();
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

// Regenerate population with new age distribution
router.post('/regenerate', async (req, res, next) => {
    try {
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
        const responseData = await populationService.applySenescenceManually();
        res.json(responseData);
    } catch (error) {
        next(error);
    }
});

// Create families for existing population
router.post('/create-families', async (req, res, next) => {
    try {
        const responseData = await populationService.createFamiliesForExistingPopulation();
        res.json(responseData);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
