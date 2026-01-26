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
    // Population growth started. (log suppressed)
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

    // Assign residency to people who turned 18
    for (const tileId of habitableTileIds) {
        await assignResidencyForAdults(pool, tileId, calendarService);
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
            // Find families to be deleted
            const familiesToDeleteResult = await pool.query(`SELECT id FROM family WHERE husband_id IN (${placeholders}) OR wife_id IN (${placeholders})`, deaths);
            const familyIdsToDelete = familiesToDeleteResult.rows.map(r => r.id);
            if (familyIdsToDelete.length > 0) {
                const famPlaceholders = familyIdsToDelete.map((_, idx) => `$${idx + 1}`).join(',');
                // Set family_id to NULL for all people in these families
                await pool.query(`UPDATE people SET family_id = NULL WHERE family_id IN (${famPlaceholders})`, familyIdsToDelete);
                // Now delete the families
                await pool.query(`DELETE FROM family WHERE id IN (${famPlaceholders})`, familyIdsToDelete);
            }
            // Now delete the people
            await pool.query(`DELETE FROM people WHERE id IN (${placeholders})`, deaths);
            if (populationServiceInstance && typeof populationServiceInstance.trackDeaths === 'function') {
                populationServiceInstance.trackDeaths(deaths.length);
            }
            // Quiet: senescence occurred (log suppressed)
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

        // Get current calendar date for age calculations
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        // Calculate age limit date (wife must be born after this date to be 33 or younger)
        const ageLimitYear = currentDate.year - 33;
        const ageLimitDate = `${ageLimitYear}-${String(currentDate.month).padStart(2, '0')}-${String(currentDate.day).padStart(2, '0')}`;

        // Random chance for new pregnancies in existing families (only wives 33 and under)
        const familiesResult = await pool.query(`
            SELECT f.id FROM family f
            JOIN people p ON f.wife_id = p.id
            WHERE f.pregnancy = FALSE 
            AND array_length(f.children_ids, 1) < 5
            AND p.date_of_birth >= $1
            ORDER BY RANDOM() 
            LIMIT 30
        `, [ageLimitDate]);

        let newPregnancies = 0;
        for (const family of familiesResult.rows) {
            // 25% daily chance of pregnancy for eligible families (increased to achieve ~40 births per 1000 per year)
            if (Math.random() < 0.25) {
                try {
                    const { startPregnancy } = require('./familyManager.js');
                    await startPregnancy(pool, calendarService, family.id);
                    newPregnancies++;
                } catch (error) {
                    // Log a concise warning and continue processing other families
                    console.warn(`[lifecycle.processDailyFamilyEvents] Could not start pregnancy for family ${family.id}: ${error.message || error}`);
                }
            }
        }

        // Release children who reach adulthood (age >= 16) from their family
        const releaseAdultsResult = await pool.query(`
            UPDATE people
            SET family_id = NULL
            WHERE family_id IS NOT NULL
              AND EXTRACT(YEAR FROM AGE(date_of_birth)) >= 16
        `);
        if (releaseAdultsResult.rowCount > 0) {
            // Quiet: released new adults (log suppressed)
        }

        if (deliveries > 0 || newPregnancies > 0) {
            // Quiet: daily family events occurred (log suppressed)
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

/**
 * Assigns residency to adults (age 18+) who don't have housing
 * @param {Pool} pool - Database pool instance
 * @param {string|number} tileId - The tile ID
 * @param {Object} calendarService - Calendar service instance
 */
async function assignResidencyForAdults(pool, tileId, calendarService) {
    try {
        // Get current date
        let currentYear = 4000, currentMonth = 1, currentDay = 1;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            const currentDate = calendarService.getCurrentDate();
            currentYear = currentDate.year;
            currentMonth = currentDate.month;
            currentDay = currentDate.day;
        }

        // Get villages for this tile
        const { rows: villages } = await pool.query(`
            SELECT id, housing_capacity, housing_slots
            FROM villages
            WHERE tile_id = $1
            ORDER BY id
        `, [tileId]);

        if (villages.length === 0) return; // No villages to assign to

        const { calculateAge } = require('./calculator.js');

        // First, move people from over-capacity villages
        for (const village of villages) {
            const occupied = village.housing_slots.length;
            if (occupied <= village.housing_capacity) continue;

            // Get 18+ people in this village
            const overPeopleResult = await pool.query(`
                SELECT id FROM people
                WHERE residency = $1 AND tile_id = $2
            `, [village.id, tileId]);

            const adultsInVillage = overPeopleResult.rows.filter(person => {
                // Get age - need date_of_birth
                const personResult = pool.query(`SELECT date_of_birth FROM people WHERE id = $1`, [person.id]);
                // Wait, better to get with date_of_birth
                // Actually, modify query
            });

            // To optimize, get people with date_of_birth
            const overAdultsResult = await pool.query(`
                SELECT p.id, p.date_of_birth FROM people p
                WHERE p.residency = $1 AND p.tile_id = $2
            `, [village.id, tileId]);

            const adultsToMove = overAdultsResult.rows.filter(person => {
                const age = calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
                return age >= 18;
            });

            // Move excess adults (over capacity) to available villages
            const excess = occupied - village.housing_capacity;
            const toMove = Math.min(adultsToMove.length, excess);

            for (let i = 0; i < toMove; i++) {
                const personId = adultsToMove[i].id;
                // Find available village
                const availableVillage = villages.find(v => v.housing_slots.length < v.housing_capacity);
                if (!availableVillage) break; // No available

                // Move person
                await pool.query(`UPDATE people SET residency = $1 WHERE id = $2`, [availableVillage.id, personId]);

                // Update slots
                const currentSlots = village.housing_slots;
                const newSlots = currentSlots.filter(id => id != personId);
                await pool.query(`UPDATE villages SET housing_slots = $1 WHERE id = $2`, [JSON.stringify(newSlots), village.id]);

                const availSlots = [...availableVillage.housing_slots, personId];
                await pool.query(`UPDATE villages SET housing_slots = $1 WHERE id = $2`, [JSON.stringify(availSlots), availableVillage.id]);

                // Update local
                village.housing_slots = newSlots;
                availableVillage.housing_slots = availSlots;
            }
        }

        // Then, assign unassigned adults
        const unassignedResult = await pool.query(`
            SELECT id, date_of_birth FROM people
            WHERE tile_id = $1 AND (residency IS NULL OR residency = 0)
        `, [tileId]);

        const unassignedAdults = unassignedResult.rows.filter(person => {
            const age = calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
            return age >= 18;
        });

        if (unassignedAdults.length === 0) return;

        let peopleIndex = 0;

        for (const village of villages) {
            const currentOccupied = village.housing_slots.length;
            const available = village.housing_capacity - currentOccupied;

            if (available <= 0 || peopleIndex >= unassignedAdults.length) continue;

            const toAssign = Math.min(available, unassignedAdults.length - peopleIndex);
            const assignedPeopleIds = unassignedAdults.slice(peopleIndex, peopleIndex + toAssign).map(p => p.id);

            // Update people residency
            await pool.query(`
                UPDATE people SET residency = $1 WHERE id = ANY($2)
            `, [village.id, assignedPeopleIds]);

            // Update village housing_slots
            const updatedSlots = [...village.housing_slots, ...assignedPeopleIds];
            await pool.query(`
                UPDATE villages SET housing_slots = $1 WHERE id = $2
            `, [JSON.stringify(updatedSlots), village.id]);

            // Update local
            village.housing_slots = updatedSlots;

            peopleIndex += toAssign;
        }
    } catch (error) {
        console.error('Error assigning residency to adults:', error);
    }
}
