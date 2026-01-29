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
const StateManager = require('../services/stateManager');
const storage = require('../services/storage');
const serverConfig = require('../config/server');

// Use route modules
router.use('/population', populationRoutes);
router.use('/tiles', tilesRoutes);
router.use('/calendar', calendarRoutes);
router.use('/db', dbRoutes);

// POST /api/save - Save game state from Redis to PostgreSQL
router.post('/save', async (req, res) => {
    try {
        console.log('💾 Save request received...');
        if (!StateManager.isRedisAvailable()) {
            console.warn('⚠️ Save attempted but Redis is not available');
            return res.status(503).json({ success: false, error: 'Redis not available - cannot save in-memory state' });
        }

        const result = await StateManager.saveToDatabase();
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error saving game:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/sync - Force full Redis sync from PostgreSQL
router.post('/sync', async (req, res) => {
    try {
        console.log('🔄 Forced sync request received...');
        const result = await StateManager.loadFromDatabase();
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error forcing sync:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/population/sync - Force population-only redis sync from Postgres
const PopulationState = require('../services/populationState');
router.post('/population/sync', async (req, res) => {
    try {
        console.log('🔄 Forced population sync request received...');
        const result = await PopulationState.syncFromPostgres();
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error forcing population sync:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/state - Get current Redis state status
router.get('/state', async (req, res) => {
    try {
        const villages = await StateManager.getAllVillages();
        const people = await StateManager.getAllPeople();
        res.json({
            initialized: StateManager.isInitialized(),
            villages: villages.length,
            people: people.length,
            totalFoodStores: villages.reduce((sum, v) => sum + (v.food_stores || 0), 0).toFixed(0)
        });
    } catch (error) {
        console.error('Error getting state:', error);
        res.status(500).json({ error: error.message });
    }
});

// REMOVED: /api/metrics endpoint (lightweight Redis metrics) removed on 2026-01-28
// This endpoint was replaced/removed as part of removing monitoring artifacts from the repository.

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

// POST /api/worldrestart - Unified restart endpoint (tiles + population + villages + calendar reset)
// REQUIRES explicit confirmation to prevent accidental data loss
router.post('/worldrestart', async (req, res) => {
    const startTime = Date.now();

    // SAFEGUARD: Require explicit confirmation to prevent accidental restarts
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE_ALL_DATA') {
        console.warn('⚠️ [worldrestart] Blocked restart attempt without confirmation');
        return res.status(400).json({
            success: false,
            message: 'World restart requires explicit confirmation. Send { "confirm": "DELETE_ALL_DATA" } in request body.',
            warning: 'This will DELETE all population data permanently!'
        });
    }

    if (serverConfig.verboseLogs) console.log('🔴 [worldrestart] CONFIRMED - Starting world restart (all data will be wiped)...');

    const populationService = req.app.locals.populationService;
    if (!populationService) {
        return res.status(500).json({ success: false, message: 'Population service unavailable' });
    }

    const PopulationState = require('../services/populationState');
    const villageSeeder = require('../services/villageSeeder');

    let calendarState = null;
    let wasRunning = false;

    try {
        // Mark restarting so tick handlers skip processing
        PopulationState.isRestarting = true;

        // Pause calendar during world restart to prevent tick events
        const calendarService = req.app.locals.calendarService;
        if (calendarService && calendarService.state && calendarService.state.isRunning) {
            wasRunning = true;
            if (serverConfig.verboseLogs) console.log('⏸️ Pausing calendar for world restart...');
            calendarService.stop();
        }

        // Regenerate tiles (internal call)
        let stepStart = Date.now();
        try {
            await selfGet('/api/tiles?regenerate=true&silent=1');
            if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Tiles regeneration: ${Date.now() - stepStart}ms`);
        } catch (regenErr) {
            console.error('[API /api/worldrestart] Regeneration failed:', regenErr.message || regenErr);
            throw regenErr;
        }

        // Reset population and reinitialize on habitable tiles
        stepStart = Date.now();
        await populationService.resetPopulation();
        if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Population reset: ${Date.now() - stepStart}ms`);

        stepStart = Date.now();
        const { rows: habitable } = await pool.query('SELECT id FROM tiles WHERE is_habitable = TRUE');
        const habitableIds = habitable.map((r) => r.id);
        if (habitableIds.length > 0) {
            await populationService.initializeTilePopulations(habitableIds);
        }
        if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Population initialization: ${Date.now() - stepStart}ms`);

        // Seed villages using storage-first approach (non-fatal)
        let seedResult = null;
        stepStart = Date.now();
        try {
            // Use storage-first seeding - reads from storage, writes to storage
            seedResult = await villageSeeder.seedVillagesStorageFirst();
            if (serverConfig.verboseLogs) console.log(`⏱️ [worldrestart] Village seeding (storage-first): ${Date.now() - stepStart}ms`);
        } catch (seedErr) {
            console.warn('[API /api/worldrestart] Village seeding failed:', seedErr.message || seedErr);
        }

        // Broadcast villages to clients from storage
        try {
            const villages = await StateManager.getAllVillages();
            if (req.app.locals.io && villages.length > 0) {
                req.app.locals.io.emit('villagesUpdated', villages);
                if (serverConfig.verboseLogs) console.log(`[API /api/worldrestart] Broadcasted ${villages.length} villages to clients`);
            }
        } catch (villageErr) {
            console.warn('[API /api/worldrestart] Village broadcast failed:', villageErr.message || villageErr);
        }

        // Reset calendar to Year 4000 and reset internal counters
        try {
            const calendarService = req.app.locals.calendarService;
            if (calendarService && typeof calendarService.setDate === 'function') {
                calendarService.setDate(1, 1, 4000);
                if (calendarService.state) {
                    if (typeof calendarService.calculateTotalDays === 'function') {
                        calendarService.state.totalDays = calendarService.calculateTotalDays(4000, 1, 1);
                    } else {
                        calendarService.state.totalDays = 0;
                    }
                    calendarService.state.totalTicks = 0;
                    calendarService.state.startTime = Date.now();
                    calendarService.state.lastTickTime = Date.now();
                }
                if (typeof calendarService.saveStateToDB === 'function') {
                    try { await calendarService.saveStateToDB(); } catch (_) { }
                }
                calendarState = calendarService.getState();
                if (calendarService.io && typeof calendarService.io.emit === 'function') {
                    calendarService.io.emit('calendarState', calendarState);
                    calendarService.io.emit('calendarDateSet', calendarState);
                }
                if (serverConfig.verboseLogs) console.log('[API /api/worldrestart] Calendar reset to Year 4000');
            }
        } catch (calErr) {
            console.warn('[API /api/worldrestart] Calendar reset failed:', calErr.message || calErr);
        }

        // Broadcast population update to all clients after restart
        try {
            await populationService.broadcastUpdate('populationReset');
            if (serverConfig.verboseLogs) console.log('[API /api/worldrestart] Population update broadcasted to clients');
        } catch (broadcastErr) {
            console.warn('[API /api/worldrestart] Failed to broadcast population update:', broadcastErr.message || broadcastErr);
        }

        const elapsed = Date.now() - startTime;
        const worldSeed = process.env.WORLD_SEED || 'unknown';
        console.log(`🎲 World restarted with seed: ${worldSeed} (took ${elapsed}ms)`);

        // Clear restarting flag and resume calendar if it was running
        PopulationState.isRestarting = false;
        if (wasRunning && req.app.locals.calendarService) {
            if (serverConfig.verboseLogs) console.log('▶️ Resuming calendar after world restart...');
            req.app.locals.calendarService.start();
        }

        return res.json({ success: true, message: 'World restarted and reinitialized', newSeed: worldSeed, calendarState, elapsed, villagesSeeded: seedResult?.created || 0 });
    } catch (error) {
        // Clear restarting flag even on error
        PopulationState.isRestarting = false;

        const elapsed = Date.now() - startTime;
        console.error('[API /api/worldrestart] Failed:', error.message || error);

        // Resume calendar even on failure if it was running
        if (wasRunning && req.app.locals.calendarService) {
            console.log('▶️ Resuming calendar after world restart failure...');
            req.app.locals.calendarService.start();
        }

        return res.status(500).json({ success: false, message: 'World restart failed', error: error.message || String(error), elapsed });
    }
});

// Deprecated: /api/reset/fast has been superseded by /api/worldrestart
router.post('/reset/fast', async (req, res) => {
    res.status(410).json({ success: false, message: '/api/reset/fast is deprecated - use /api/worldrestart' });
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
