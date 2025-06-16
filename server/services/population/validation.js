// Population Validation - Handles validation logic for population operations

/**
 * Validates that tile IDs are in the correct format
 * @param {Array} tileIds - Array of tile IDs to validate
 * @throws {Error} If tileIds format is invalid
 */
function validateTileIds(tileIds) {
    if (!Array.isArray(tileIds) || !tileIds.every(id => typeof id === 'string' || typeof id === 'number')) {
        throw new Error('Invalid tileIds: Must be an array of strings or numbers.');
    }
}

/**
 * Validates population count
 * @param {number} population - Population count to validate
 * @throws {Error} If population is invalid
 */
function validatePopulationCount(population) {
    if (typeof population !== 'number' || population < 0 || !Number.isInteger(population)) {
        throw new Error('Population count must be a non-negative integer');
    }
}

/**
 * Validates growth rate
 * @param {number} rate - Growth rate to validate
 * @throws {Error} If growth rate is invalid
 */
function validateGrowthRate(rate) {
    if (typeof rate !== 'number' || rate < 0) {
        throw new Error('Growth rate must be a non-negative number');
    }
}

/**
 * Validates tile population mapping object
 * @param {Object} tilePopulations - Object with tileId -> population mappings
 * @throws {Error} If tilePopulations format is invalid
 */
function validateTilePopulations(tilePopulations) {
    if (!tilePopulations || typeof tilePopulations !== 'object') {
        throw new Error('tilePopulations must be an object');
    }

    for (const [tileId, population] of Object.entries(tilePopulations)) {
        if (typeof tileId !== 'string' && typeof tileId !== 'number') {
            throw new Error(`Invalid tile ID: ${tileId}. Must be string or number.`);
        }
        if (typeof population !== 'number' || population < 0) {
            throw new Error(`Invalid population for tile ${tileId}: ${population}. Must be non-negative number.`);
        }
    }
}

/**
 * Validates database pool instance
 * @param {Object} pool - Database pool to validate
 * @throws {Error} If pool is invalid
 */
function validateDatabasePool(pool) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Invalid database pool: must have a query method');
    }
}

/**
 * Validates service dependencies
 * @param {Object} serviceInstance - Service instance to validate
 * @param {Object} calendarService - Calendar service to validate
 * @throws {Error} If dependencies are invalid
 */
function validateServiceDependencies(serviceInstance, calendarService = null) {
    if (!serviceInstance) {
        throw new Error('Service instance is required');
    }

    if (calendarService && typeof calendarService.getCurrentDate !== 'function') {
        console.warn('Calendar service provided but does not have getCurrentDate method');
    }
}

module.exports = {
    validateTileIds,
    validatePopulationCount,
    validateGrowthRate,
    validateTilePopulations,
    validateDatabasePool,
    validateServiceDependencies
};
