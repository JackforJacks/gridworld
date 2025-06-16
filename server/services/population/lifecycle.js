// Population Lifecycle Management - Handles growth, aging, and life cycle events
const config = require('../../config/server.js');

/**
 * Starts population growth simulation
 * @param {PopulationService} serviceInstance - The population service instance
 */
function startGrowth(serviceInstance) {
    stopGrowth(serviceInstance);
    serviceInstance.growthInterval = setInterval(async () => {
        try {
            await updatePopulations(serviceInstance);
        } catch (error) {
            console.error('❌ Error updating populations:', error);
        }
    }, config.populationGrowthInterval);
    console.log('Population growth started.');
}

/**
 * Stops population growth simulation
 * @param {PopulationService} serviceInstance - The population service instance
 */
function stopGrowth(serviceInstance) {
    if (serviceInstance.growthInterval) {
        clearInterval(serviceInstance.growthInterval);
        serviceInstance.growthInterval = null;
    }
}

/**
 * Updates all populations based on growth rate
 * @param {PopulationService} serviceInstance - The population service instance
 */
async function updatePopulations(serviceInstance) {
    const populations = await serviceInstance.loadData();
    const habitableTileIds = Object.keys(populations);

    if (habitableTileIds.length === 0) return;

    const growthRate = config.defaultGrowthRate;
    let totalGrowth = 0;

    for (const tileId of habitableTileIds) {
        const growth = calculateGrowthForTile(tileId, growthRate);
        const currentPopulation = populations[tileId];
        const newPopulation = currentPopulation + growth;
        totalGrowth += growth;

        if (growth !== 0) {
            await serviceInstance.updatePopulation(tileId, newPopulation);
        }
    }

    if (totalGrowth > 0) {
        await serviceInstance.broadcastUpdate();
    }
}

/**
 * Calculates growth for a specific tile
 * @param {string|number} tileId - The tile ID
 * @param {number} baseGrowthRate - Base growth rate
 * @returns {number} Growth amount
 */
function calculateGrowthForTile(tileId, baseGrowthRate) {
    // Basic growth rate implementation
    // This could be enhanced with more complex factors like:
    // - Resource availability
    // - Population density
    // - Environmental factors
    return baseGrowthRate;
}

/**
 * Updates growth rate configuration
 * @param {PopulationService} serviceInstance - The population service instance
 * @param {number} rate - New growth rate
 * @returns {Object} Updated population data
 */
async function updateGrowthRate(serviceInstance, rate) {
    if (typeof rate !== 'number' || rate < 0) {
        throw new Error('Growth rate must be a non-negative number');
    }

    const responseData = await serviceInstance.getAllPopulationData();
    if (serviceInstance.io) {
        serviceInstance.io.emit('populationUpdate', responseData);
    }
    return responseData;
}

/**
 * Applies senescence (aging deaths) to the population
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @returns {number} Number of deaths
 */
async function applySenescence(pool, calendarService, populationServiceInstance) {
    try {
        let currentYear = 4000, currentMonth = 1, currentDay = 1;
        try {
            if (calendarService && typeof calendarService.getState === 'function') {
                const state = calendarService.getState();
                if (state && state.currentDate) {
                    currentYear = state.currentDate.year;
                    currentMonth = state.currentDate.month;
                    currentDay = state.currentDate.day;
                }
            }
        } catch (e) {
            console.warn('Using fallback calendar date for senescence due to error:', e);
        }

        const cutoffYear = currentYear - 60;
        const cutoffDate = `${cutoffYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;

        const result = await pool.query(
            'SELECT id, date_of_birth, tile_id FROM people WHERE date_of_birth < $1',
            [cutoffDate]
        );

        const elderlyPeople = result.rows;
        const deaths = [];
        const { calculateAge } = require('./calculator.js');

        for (const person of elderlyPeople) {
            const age = calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
            if (age >= 60) {
                const monthlyDeathChance = (age - 59) * 0.0005;
                if (Math.random() < monthlyDeathChance) {
                    deaths.push(person.id);
                }
            }
        }

        if (deaths.length > 0) {
            const placeholders = deaths.map((_, idx) => `$${idx + 1}`).join(',');
            await pool.query(`DELETE FROM people WHERE id IN (${placeholders})`, deaths);
            if (populationServiceInstance && typeof populationServiceInstance.trackDeaths === 'function') {
                populationServiceInstance.trackDeaths(deaths.length);
            }
            console.log(`💀 Senescence: ${deaths.length} people died of old age`);
            return deaths.length;
        }
        return 0;
    } catch (error) {
        console.error('Error applying senescence:', error);
        return 0;
    }
}

/**
 * Processes daily family events (pregnancies, births)
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} serviceInstance - Population service instance
 * @returns {Object} Daily family events summary
 */
async function processDailyFamilyEvents(pool, calendarService, serviceInstance) {
    try {
        const { processDeliveries } = require('./familyManager.js');
        
        // Process deliveries for families ready to give birth
        const deliveries = await processDeliveries(pool, calendarService, serviceInstance);
        
        // Random chance for new pregnancies in existing families
        const familiesResult = await pool.query(`
            SELECT id FROM family 
            WHERE pregnancy = FALSE 
            AND array_length(children_ids, 1) < 5
            ORDER BY RANDOM() 
            LIMIT 10
        `);
        
        let newPregnancies = 0;
        for (const family of familiesResult.rows) {
            // 5% daily chance of pregnancy for eligible families
            if (Math.random() < 0.05) {
                try {
                    const { startPregnancy } = require('./familyManager.js');
                    await startPregnancy(pool, calendarService, family.id);
                    newPregnancies++;
                } catch (error) {
                    // Silent fail for pregnancy attempts
                }
            }
        }
        
        if (deliveries > 0 || newPregnancies > 0) {
            console.log(`👪 Daily family events: ${deliveries} births, ${newPregnancies} new pregnancies`);
        }
        
        return {
            deliveries,
            newPregnancies
        };
    } catch (error) {
        console.error('Error processing daily family events:', error);
        return { deliveries: 0, newPregnancies: 0 };
    }
}

module.exports = {
    startGrowth,
    stopGrowth,
    updatePopulations,
    calculateGrowthForTile,
    updateGrowthRate,
    applySenescence,
    processDailyFamilyEvents
};
