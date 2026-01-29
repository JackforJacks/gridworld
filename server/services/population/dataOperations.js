// Population Data Operations - Handles data loading, saving, and formatting
const { getTotalPopulation } = require('./PopStats.js');
const storage = require('../storage');

/**
 * Loads population data - tries Redis first (hot data), falls back to Postgres
 * @param {Pool} pool - Database pool instance
 * @returns {Object} Population data by tile ID
 */
async function loadPopulationData(pool) {
    try {
        // Try storage first for tile populations (hot data after restart)
        // If storage isn't available yet, wait briefly for it to become ready (useful during restarts)
        if (!storage.isAvailable()) {
            // wait up to 2000ms for storage to emit 'ready' if storage exposes an 'on' event API
            if (typeof storage.on === 'function') {
                await Promise.race([
                    new Promise(resolve => storage.on('ready', resolve)),
                    new Promise(resolve => setTimeout(resolve, 2000))
                ]);
            } else {
                // storage adapter doesn't provide events in this environment; short sleep to avoid stalling tests
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        if (storage.isAvailable()) {
            try {
                const PopulationState = require('../populationState');
                // Poll a few times in case initialization is writing people in batches
                for (let attempt = 0; attempt < 6; attempt++) {
                    const populations = await PopulationState.getAllTilePopulations();
                    if (Object.keys(populations).length > 0) {
                        return populations;
                    }
                    // Small backoff between polls
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                // If storage is available but no populations found after polling, fall through to Postgres fallback
            } catch (e) {
                console.warn('[loadPopulationData] storage failed, falling back to Postgres:', e.message);
            }
        }

        // Fall back to Postgres
        const result = await pool.query('SELECT tile_id, COUNT(*) as population FROM people GROUP BY tile_id');
        const populations = {};
        result.rows.forEach(row => {
            populations[row.tile_id] = parseInt(row.population, 10);
        });
        return populations;
    } catch (error) {
        console.error('Error loading data from database:', error);
        return {};
    }
}

/**
 * Saves population data from Redis to Postgres
 * @returns {Object} Save result with counts
 */
async function savePopulationData() {
    try {
        const StateManager = require('../stateManager');
        const result = await StateManager.saveToDatabase();
        return result;
    } catch (error) {
        console.error('[dataOperations] savePopulationData failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Formats population data for client consumption
 * @param {Object} populations - Raw population data
 * @returns {Object} Formatted population data
 */
function formatPopulationData(populations = null) {
    if (!populations) {
        populations = {};
    }
    return {
        tilePopulations: populations,
        totalPopulation: getTotalPopulation(populations),
        totalTiles: Object.keys(populations).length,
        lastUpdated: new Date().toISOString()
    };
}

module.exports = {
    loadPopulationData,
    savePopulationData,
    formatPopulationData
};
