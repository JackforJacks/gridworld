// Main API Routes
const express = require('express');
const router = express.Router();

// Import route modules
const populationRoutes = require('./population');
const DatabaseService = require('../services/databaseService');
const dbService = new DatabaseService();

// Use route modules
router.use('/population', populationRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        server: 'GridWorld',
        version: '2.0.0'
    });
});

// API info endpoint
router.get('/', (req, res) => {
    res.json({
        name: 'GridWorld API',
        version: '2.0.0',
        endpoints: {
            health: '/api/health',
            population: '/api/population',
            'population.get': 'GET /api/population',
            'population.update': 'POST /api/population',
            'population.initialize': 'POST /api/population/initialize',
            'population.reset': 'GET /api/population/reset'
        }
    });
});

// POST /api/reset-all - Truncate all tables dynamically
router.post('/reset-all', async (req, res) => {
    try {
        const result = await dbService.truncateAllTables();
        res.json({
            success: true,
            message: result.message,
            tables: result.tables,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to truncate all tables',
            details: error.message
        });
    }
});

module.exports = router;
