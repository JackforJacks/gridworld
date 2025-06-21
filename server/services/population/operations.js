// Population Operations - Handles population manipulation and management
const { addPeopleToTile, removePeopleFromTile } = require('./manager.js');
const { ensureTableExists } = require('./initializer.js');
const { Procreation } = require('./family.js');

/**
 * Updates population for a specific tile
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} serviceInstance - Population service instance
 * @param {string|number} tileId - The tile ID
 * @param {number} population - New population count
 */
async function updateTilePopulation(pool, calendarService, serviceInstance, tileId, population) {
    await Procreation(pool, calendarService, serviceInstance, tileId, population);
}

/**
 * Resets all population data
 * @param {Pool} pool - Database pool instance
 * @param {PopulationService} serviceInstance - Population service instance
 * @returns {Object} Formatted empty population data
 */
async function resetAllPopulation(pool, serviceInstance) {
    try {
        console.log('[resetAllPopulation] Attempting to truncate people and families tables...');
        // Truncate people, families, and family tables to clear all data and reset sequences.
        await pool.query('TRUNCATE TABLE people, families, family RESTART IDENTITY CASCADE');
        console.log('[resetAllPopulation] Truncate successful. Broadcasting update...');
        await serviceInstance.broadcastUpdate('populationReset');
        const { formatPopulationData } = require('./dataOperations.js');
        return formatPopulationData({});
    } catch (error) {
        console.error('[resetAllPopulation] Error details:', error);
        throw error;
    }
}

/**
 * Initializes population for multiple tiles
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} serviceInstance - Population service instance
 * @param {Array} tileIds - Array of tile IDs to initialize
 * @returns {Object} Formatted population data
 */
async function initializeTilePopulations(pool, calendarService, serviceInstance, tileIds) {
    console.log('[PopulationOperations] initializeTilePopulations called with tileIds:', tileIds);

    try {        // Import validation and data operations
        const { validateTileIds } = require('./validation.js');
        const { loadPopulationData, formatPopulationData } = require('./dataOperations.js');

        validateTileIds(tileIds);

        if (!Array.isArray(tileIds) || tileIds.length === 0) {
            console.warn('[PopulationOperations] initializeTilePopulations: No tile IDs provided or empty array.');
            return {
                success: false,
                message: 'No tile IDs provided',
                tilePopulations: {},
                totalPopulation: 0,
                totalTiles: 0,
                lastUpdated: new Date().toISOString()
            };
        }

        await pool.query('DELETE FROM people');

        // Get current date from calendar service
        let currentDate;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        } else {
            console.warn('[PopulationOperations] CalendarService not available. Using fallback date.');
            currentDate = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;

        for (const tile_id of tileIds) {
            const tilePopulation = Math.floor(80 + Math.random() * 41);
            await addPeopleToTile(pool, tile_id, tilePopulation, currentYear, currentMonth, currentDay, serviceInstance, false);
        }

        const populations = await loadPopulationData(pool);
        return formatPopulationData(populations);
    } catch (error) {
        console.error('[PopulationOperations] Critical error in initializeTilePopulations:', error);
        console.error('[PopulationOperations] tileIds at time of error:', tileIds);
        throw error;
    }
}

/**
 * Updates populations for multiple tiles
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} serviceInstance - Population service instance
 * @param {Object} tilePopulations - Object with tileId -> population mappings
 * @returns {Object} Formatted population data
 */
async function updateMultipleTilePopulations(pool, calendarService, serviceInstance, tilePopulations) {
    if (!tilePopulations || typeof tilePopulations !== 'object') {
        throw new Error('tilePopulations must be an object');
    }

    const { loadPopulationData, formatPopulationData } = require('./dataOperations.js');

    let totalUpdated = 0;
    for (const [tileId, population] of Object.entries(tilePopulations)) {
        if (typeof population === 'number' && population >= 0) {
            await updateTilePopulation(pool, calendarService, serviceInstance, tileId, population);
            totalUpdated++;
        }
    }

    const populations = await loadPopulationData(pool);
    return formatPopulationData(populations);
}

/**
 * Regenerates population with new age distribution
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} serviceInstance - Population service instance
 * @returns {Object} Formatted population data
 */
async function regeneratePopulationWithNewAgeDistribution(pool, calendarService, serviceInstance) {
    try {
        console.log('🔄 Regenerating population with new age distribution...');

        const { loadPopulationData, formatPopulationData } = require('./dataOperations.js');

        const existingPopulations = await loadPopulationData(pool);
        const tileIds = Object.keys(existingPopulations);

        if (tileIds.length === 0) {
            console.log('No existing population found to regenerate');
            return formatPopulationData({});
        }

        const currentPopulations = { ...existingPopulations };
        await pool.query('DELETE FROM people');

        // Get current date from calendar service
        let currentDate;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        } else {
            console.warn('[PopulationOperations] CalendarService not available. Using fallback date.');
            currentDate = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;

        for (const tileId of tileIds) {
            const populationCount = currentPopulations[tileId];
            await addPeopleToTile(pool, tileId, populationCount, currentYear, currentMonth, currentDay, serviceInstance, false);
            console.log(`✅ Regenerated ${populationCount} people for tile ${tileId}`);
        }

        await serviceInstance.broadcastUpdate('populationRegenerated');
        const populations = await loadPopulationData(pool);
        console.log('🎉 Population regeneration complete!');

        return formatPopulationData(populations);
    } catch (error) {
        console.error('Error regenerating population:', error);
        throw error;
    }
}

module.exports = {
    updateTilePopulation,
    resetAllPopulation,
    initializeTilePopulations,
    updateMultipleTilePopulations,
    regeneratePopulationWithNewAgeDistribution
};
