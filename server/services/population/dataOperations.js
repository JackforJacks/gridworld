// Population Data Operations - Handles data loading, saving, and formatting
const { getTotalPopulation } = require('./PopStats.js');

/**
 * Loads population data from database
 * @param {Pool} pool - Database pool instance
 * @returns {Object} Population data by tile ID
 */
async function loadPopulationData(pool) {
    try {
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
 * Saves population data (placeholder for future implementation)
 * @returns {boolean} Always returns true for now
 */
async function savePopulationData() {
    // Placeholder for data saving logic
    // Could implement batch saves, data validation, etc.
    return true;
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
