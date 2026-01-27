// Population Lifecycle Management - Handles growth, aging, and life cycle events
const config = require('../../config/server.js');
const storage = require('../storage');

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
 * Applies senescence (aging deaths) to the population - storage-only (Postgres deletes happen on Save)
 * @param {Pool} pool - Database pool instance (used for family queries only)
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {number} daysAdvanced - Number of days that passed in this tick (default 1)
 * @returns {number} Number of deaths
 */
async function applySenescence(pool, calendarService, populationServiceInstance, daysAdvanced = 1) {
    try {
        const PopulationState = require('../populationState');

        if (!storage.isAvailable()) {
            console.warn('⚠️ Storage not available - cannot process senescence');
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
        const DAYS_PER_YEAR = 96; // 8 days/month * 12 months

        for (const person of allPeople) {
            if (!person.date_of_birth) continue;

            const age = calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
            if (age >= 60) {
                // Annual death probability: starts at 1% at age 60, increases by 2% per year
                const annualDeathChance = 0.01 + (age - 60) * 0.02;
                // Daily probability
                const dailyDeathChance = annualDeathChance / DAYS_PER_YEAR;
                // Probability of dying at least once in N days: 1 - (1 - p)^N
                const multiDayDeathChance = 1 - Math.pow(1 - dailyDeathChance, daysAdvanced);
                if (Math.random() < multiDayDeathChance) {
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
                    // Delete the family from storage
                    await storage.hdel('family', family.id.toString());
                    // Track for Postgres delete only if it's a positive ID (exists in Postgres)
                    if (family.id > 0) {
                        await storage.sadd('pending:family:deletes', family.id.toString());
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
 * Processes family events (pregnancies, births) for the tick
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} serviceInstance - Population service instance
 * @param {number} daysAdvanced - Number of days that passed in this tick (default 1)
 * @returns {Object} Family events summary
 */
async function processDailyFamilyEvents(pool, calendarService, serviceInstance, daysAdvanced = 1) {
    try {
        const { processDeliveries, startPregnancy } = require('./familyManager.js');
        const PopulationState = require('../populationState');
        const { calculateAge } = require('./calculator.js');

        // Skip if restart is in progress
        if (PopulationState.isRestarting) {
            return { deliveries: 0, newPregnancies: 0 };
        }

        // Process deliveries for families ready to give birth (pass daysAdvanced for delivery timing)
        const deliveries = await processDeliveries(pool, calendarService, serviceInstance, daysAdvanced);

        // Get current calendar date for age calculations
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        // Use storage-based fertile family set for faster pregnancy processing
        const candidateCount = parseInt(await storage.scard('eligible:pregnancy:families'), 10) || 0;
        const sampleCount = Math.min(candidateCount, 60); // sample up to 60 and process up to 30
        const sampled = sampleCount > 0 ? (await storage.smembers('eligible:pregnancy:families')).sort(() => 0.5 - Math.random()).slice(0, sampleCount) : [];

        let newPregnancies = 0;
        for (const fid of sampled) {
            const familyId = parseInt(fid);
            try {
                const family = await PopulationState.getFamily(familyId);
                if (!family) continue;
                // Ensure family is still eligible
                if (family.pregnancy) continue;
                if ((family.children_ids || []).length >= 5) continue;

                const wife = await PopulationState.getPerson(family.wife_id);
                if (!wife || !wife.date_of_birth) continue;
                const wifeAge = calculateAge(wife.date_of_birth, currentDate.year, currentDate.month, currentDate.day);
                if (wifeAge > 33) {
                    // Remove from fertile set if aged out
                    try { await PopulationState.removeFertileFamily(familyId); } catch (_) { }
                    continue;
                }

                // 25% daily chance of pregnancy, adjusted for multiple days
                // Probability of pregnancy in N days: 1 - (1 - 0.25)^N
                const dailyPregnancyChance = 0.25;
                const multiDayPregnancyChance = 1 - Math.pow(1 - dailyPregnancyChance, daysAdvanced);
                if (Math.random() < multiDayPregnancyChance) {
                    try {
                        const started = await startPregnancy(pool, calendarService, familyId);
                        if (started) newPregnancies++;
                    } catch (error) {
                        console.warn(`[lifecycle.processDailyFamilyEvents] Could not start pregnancy for family ${familyId}: ${error.message || error}`);
                    }
                }
            } catch (err) {
                console.warn('[processDailyFamilyEvents] error processing candidate family:', fid, err && err.message ? err.message : err);
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

                            // Add newly released adult to eligible matchmaking sets
                            try {
                                await PopulationState.addEligiblePerson(person, currentDate.year, currentDate.month, currentDate.day);
                            } catch (e) {
                                console.warn('[lifecycle] addEligiblePerson failed for released adult:', e && e.message ? e.message : e);
                            }

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
