// Main API Routes
const express = require('express');
const router = express.Router();

// Import route modules
const populationRoutes = require('./population');
const tilesRoutes = require('./tiles');
const calendarRoutes = require('./calendar');
const dbRoutes = require('./db');
const DatabaseService = require('../services/databaseService');
const dbService = new DatabaseService();
const http = require('http');
const pool = require('../config/database');
const villageSeeder = require('../services/villageSeeder');

// Use route modules
router.use('/population', populationRoutes);
router.use('/tiles', tilesRoutes);
router.use('/calendar', calendarRoutes);
router.use('/db', dbRoutes);

// Helper: internal GET request to this server
async function selfGet(path) {
    const port = process.env.PORT || 3000;
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port, path, method: 'GET', timeout: 300000 }, (resp) => {
            let data = '';
            resp.on('data', (chunk) => { data += chunk; });
            resp.on('end', () => {
                if (resp.statusCode >= 200 && resp.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data || '{}'));
                    } catch (_) {
                        resolve({});
                    }
                } else {
                    reject(new Error(`Status ${resp.statusCode}`));
                }
            });
        });
        req.on('error', (err) => {
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
router.get('/config', (req, res) => {
    res.json({
        hexasphere: {
            radius: parseFloat(process.env.HEXASPHERE_RADIUS) || 30,
            subdivisions: parseFloat(process.env.HEXASPHERE_SUBDIVISIONS) || 3,
            tileWidthRatio: parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO) || 1
        }
    });
});

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
            tiles: '/api/tiles',
            'population.get': 'GET /api/population',
            'population.update': 'POST /api/population',
            'population.initialize': 'POST /api/population/initialize',
            'population.reset': 'GET /api/population/reset'
        }
    });
});

// POST /api/reset/fast - end-to-end reset in one call (no migrations)
router.post('/reset/fast', async (req, res) => {
    const populationService = req.app.locals.populationService;
    if (!populationService) {
        return res.status(500).json({ success: false, message: 'Population service unavailable' });
    }

    const status = {
        regeneratedTiles: false,
        populationReset: false,
        populationsInitialized: false,
        villagesSeeded: 0
    };

    try {
        // 1) Regenerate tiles/lands via internal call (silent to avoid huge payload)
        try {
            await selfGet('/api/tiles?regenerate=true&silent=1');
            status.regeneratedTiles = true;
        } catch (regenErr) {
            console.error('[API /api/reset/fast] Regeneration failed:', regenErr.message || regenErr);
            return res.status(500).json({ success: false, step: 'regenerate', error: regenErr.message || String(regenErr) });
        }

        // 2) Reset population and reinitialize on habitable tiles
        try {
            await populationService.resetPopulation();
            status.populationReset = true;
        } catch (popResetErr) {
            console.error('[API /api/reset/fast] Population reset failed:', popResetErr.message || popResetErr);
            return res.status(500).json({ success: false, step: 'populationReset', error: popResetErr.message || String(popResetErr) });
        }

        try {
            const { rows: habitable } = await pool.query('SELECT id FROM tiles WHERE is_habitable = TRUE');
            const habitableIds = habitable.map((r) => r.id);
            if (habitableIds.length > 0) {
                await populationService.initializeTilePopulations(habitableIds);
            }
            status.populationsInitialized = true;
        } catch (popInitErr) {
            console.error('[API /api/reset/fast] Population init failed:', popInitErr.message || popInitErr);
            return res.status(500).json({ success: false, step: 'populationInit', error: popInitErr.message || String(popInitErr) });
        }

        // 3) Seed villages on populated tiles (non-fatal)
        try {
            const seedResult = await villageSeeder.seedRandomVillages();
            status.villagesSeeded = seedResult && seedResult.created ? seedResult.created : 0;
        } catch (seedErr) {
            console.warn('[API /api/reset/fast] Village seeding failed:', seedErr.message || seedErr);
        }

        return res.json({ success: true, ...status });
    } catch (error) {
        console.error('[API /api/reset/fast] Failed:', error.message || error);
        return res.status(500).json({ success: false, message: 'Fast reset failed', error: error.message || String(error), ...status });
    }
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

// Vital rates endpoint (in-memory, no DB)
router.get('/statistics/vital-rates/:years', (req, res) => {
    try {
        const years = parseInt(req.params.years) || 100;
        // Get the population service (should be attached to app.locals)
        const populationService = req.app.locals?.populationService;
        if (!populationService || typeof populationService.getStatisticsService !== 'function') {
            return res.status(503).json({ success: false, error: 'Statistics service not available' });
        }
        const statisticsService = populationService.getStatisticsService();
        if (!statisticsService) {
            return res.status(503).json({ success: false, error: 'Statistics service not available' });
        }
        const chartData = statisticsService.getVitalRatesForChart(years);
        res.json({ success: true, data: chartData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
