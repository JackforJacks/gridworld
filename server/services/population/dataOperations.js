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
        if (storage.isAvailable()) {
            try {
                const PopulationState = require('../populationState');
                const populations = await PopulationState.getAllTilePopulations();
                if (Object.keys(populations).length > 0) {
                    return populations;
                }
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
