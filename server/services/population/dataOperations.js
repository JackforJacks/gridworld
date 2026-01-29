// Population Data Operations - Handles data loading, saving, and formatting
const { getTotalPopulation } = require('./PopStats.js');
const storage = require('../storage');

/**
 * Loads population data from Redis (only source of truth)
 * @param {Pool} pool - Database pool instance (unused, kept for API compatibility)
 * @returns {Object} Population data by tile ID
 */
async function loadPopulationData(pool) {
    try {
        // Wait for storage to be available if needed
        if (!storage.isAvailable()) {
            if (typeof storage.on === 'function') {
                await Promise.race([
                    new Promise(resolve => storage.on('ready', resolve)),
                    new Promise(resolve => setTimeout(resolve, 2000))
                ]);
            } else {
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
            } catch (e) {
                console.warn('[loadPopulationData] storage failed:', e.message);
            }
        }

        // Return empty if Redis has no data (no Postgres fallback)
        return {};
    } catch (error) {
        console.error('Error loading data from storage:', error);
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
