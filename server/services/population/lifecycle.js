// Population Lifecycle Management - Handles growth, aging, and life cycle events
const config = require('../../config/server.js');
const redis = require('../../config/redis');

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
 * Applies senescence (aging deaths) to the population - Redis-only (Postgres deletes happen on Save)
 * @param {Pool} pool - Database pool instance (used for family queries only)
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @returns {number} Number of deaths
 */
async function applySenescence(pool, calendarService, populationServiceInstance) {
    try {
        const PopulationState = require('../populationState');
        const { isRedisAvailable } = require('../../config/redis');
        
        if (!isRedisAvailable()) {
            console.warn('⚠️ Redis not available - cannot process senescence');
            return 0;
        }

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

        // Get all people from Redis
        const allPeople = await PopulationState.getAllPeople();
        const { calculateAge } = require('./calculator.js');

        const deaths = [];

        for (const person of allPeople) {
            if (!person.date_of_birth) continue;
            
            const age = calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
            if (age >= 60) {
                const monthlyDeathChance = (age - 59) * 0.0005;
                if (Math.random() < monthlyDeathChance) {
                    deaths.push(person.id);
                }
            }
        }

        if (deaths.length > 0) {
            // Handle family cleanup (now using Redis for families)
            const deathIds = new Set(deaths);
            const allFamilies = await PopulationState.getAllFamilies();
            
            for (const family of allFamilies) {
                // Check if husband or wife died
                const husbandDied = deathIds.has(family.husband_id);
                const wifeDied = deathIds.has(family.wife_id);
                
                if (husbandDied || wifeDied) {
                    // Clear family_id from all family members in Redis
                    await PopulationState.updatePerson(family.husband_id, { family_id: null });
                    await PopulationState.updatePerson(family.wife_id, { family_id: null });
                    for (const childId of (family.children_ids || [])) {
                        await PopulationState.updatePerson(childId, { family_id: null });
                    }
                    // Delete the family from Redis
                    await redis.hdel('family', family.id.toString());
                    // Track for Postgres delete only if it's a positive ID (exists in Postgres)
                    if (family.id > 0) {
                        await redis.sadd('pending:family:deletes', family.id.toString());
                    }
                }
            }
            
            // Remove from Redis (this tracks for batch Postgres delete)
            for (const personId of deaths) {
                await PopulationState.removePerson(personId, true);
            }
            
            if (populationServiceInstance && typeof populationServiceInstance.trackDeaths === 'function') {
                populationServiceInstance.trackDeaths(deaths.length);
            }
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
        const { processDeliveries, startPregnancy } = require('./familyManager.js');
        const PopulationState = require('../populationState');
        const { calculateAge } = require('./calculator.js');

        // Process deliveries for families ready to give birth
        const deliveries = await processDeliveries(pool, calendarService, serviceInstance);

        // Get current calendar date for age calculations
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        // Get eligible families from Redis (not pregnant, less than 5 children)
        const allFamilies = await PopulationState.getAllFamilies();
        const eligibleFamilies = allFamilies.filter(f => 
            !f.pregnancy && (!f.children_ids || f.children_ids.length < 5)
        );
        // Shuffle and take up to 30
        const shuffledFamilies = eligibleFamilies.sort(() => Math.random() - 0.5).slice(0, 30);

        let newPregnancies = 0;
        for (const family of shuffledFamilies) {
            // Check wife's age from Redis
            const wife = await PopulationState.getPerson(family.wife_id);
            if (!wife || !wife.date_of_birth) continue;
            
            const wifeAge = calculateAge(wife.date_of_birth, currentDate.year, currentDate.month, currentDate.day);
            if (wifeAge > 33) continue; // Wife too old

            // 25% daily chance of pregnancy for eligible families
            if (Math.random() < 0.25) {
                try {
                    await startPregnancy(pool, calendarService, family.id);
                    newPregnancies++;
                } catch (error) {
                    // Log a concise warning and continue processing other families
                    console.warn(`[lifecycle.processDailyFamilyEvents] Could not start pregnancy for family ${family.id}: ${error.message || error}`);
                }
            }
        }

        // Release children who reach adulthood (age >= 16) from their family - update Redis
        const allPeople = await PopulationState.getAllPeople();
        let releasedAdults = 0;
        for (const person of allPeople) {
            if (person.family_id && person.date_of_birth) {
                const age = calculateAge(person.date_of_birth, currentDate.year, currentDate.month, currentDate.day);
                if (age >= 16) {
                    // Check if this person is a child (not the husband or wife) - use Redis
                    const family = await PopulationState.getFamily(person.family_id);
                    if (family) {
                        if (person.id !== family.husband_id && person.id !== family.wife_id) {
                            await PopulationState.updatePerson(person.id, { family_id: null });
                            // Also remove from children_ids
                            const newChildrenIds = (family.children_ids || []).filter(cid => cid !== person.id);
                            await PopulationState.updateFamily(family.id, { children_ids: newChildrenIds });
                            releasedAdults++;
                        }
                    }
                }
            }
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
