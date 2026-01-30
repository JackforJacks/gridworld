// Population Lifecycle Management - Handles growth, aging, and life cycle events
const config = require('../../config/server.js');
const storage = require('../storage');
const deps = require('./dependencyContainer');

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
        const PopulationState = deps.getPopulationState();

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
        const { calculateAge } = deps.getCalculator();

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
            // Handle family cleanup using optimized batch operations
            const deathIds = new Set(deaths);
            const allFamilies = await PopulationState.getAllFamilies();

            // Collect all person IDs that need family_id cleared and families to delete
            const personIdsToClear = [];
            const familyIdsToDelete = [];

            for (const family of allFamilies) {
                // Check if husband or wife died
                const husbandDied = deathIds.has(family.husband_id);
                const wifeDied = deathIds.has(family.wife_id);

                if (husbandDied || wifeDied) {
                    // Collect all family members for batch update
                    personIdsToClear.push(family.husband_id, family.wife_id);
                    for (const childId of (family.children_ids || [])) {
                        personIdsToClear.push(childId);
                    }
                    familyIdsToDelete.push(family.id);
                }
            }

            // Batch clear family_id for all affected persons
            if (personIdsToClear.length > 0) {
                await PopulationState.batchClearFamilyIds(personIdsToClear);
            }

            // Batch delete families (tracks positive IDs for Postgres deletion)
            if (familyIdsToDelete.length > 0) {
                await PopulationState.batchDeleteFamilies(familyIdsToDelete, true);
            }

            // Batch remove deceased persons from Redis
            await PopulationState.batchRemovePersons(deaths, true);

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
        const { processDeliveries, startPregnancy } = deps.getFamilyManager();
        const PopulationState = deps.getPopulationState();
        const { calculateAge } = deps.getCalculator();

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
 * Optimized: Uses batch operations for better Redis performance
 * @param {Pool} pool - Database pool instance
 * @param {string|number} tileId - The tile ID
 * @param {Object} calendarService - Calendar service instance
 */
async function assignResidencyForAdults(pool, tileId, calendarService) {
    try {
        const StateManager = deps.getStateManager();
        const PopulationState = deps.getPopulationState();

        // Get current date
        let currentYear = 4000, currentMonth = 1, currentDay = 1;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            const currentDate = calendarService.getCurrentDate();
            currentYear = currentDate.year;
            currentMonth = currentDate.month;
            currentDay = currentDate.day;
        }

        // Get villages for this tile from Redis
        const allVillages = await StateManager.getAllVillages();
        const villages = allVillages.filter(v => v.tile_id == tileId);

        if (villages.length === 0) return; // No villages to assign to

        const { calculateAge } = deps.getCalculator();

        // Get all people from Redis
        const allPeople = await PopulationState.getAllPeople();
        const tilePeople = allPeople.filter(p => p.tile_id == tileId);

        // Collect all residency updates for batch processing
        const residencyUpdates = [];
        const villageSlotUpdates = new Map(); // villageId -> { add: [], remove: [] }

        // First, move people from over-capacity villages
        for (const village of villages) {
            const occupied = Array.isArray(village.housing_slots) ? village.housing_slots.length : 0;
            if (occupied <= village.housing_capacity) continue;

            // Get 18+ people in this village
            const adultsInVillage = tilePeople.filter(person => {
                if (person.residency != village.id) return false;
                if (!person.date_of_birth) return false;
                const age = calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
                return age >= 18;
            });

            // Move excess adults (over capacity) to available villages
            const excess = occupied - village.housing_capacity;
            const toMove = Math.min(adultsInVillage.length, excess);

            for (let i = 0; i < toMove; i++) {
                const person = adultsInVillage[i];
                // Find available village
                const availableVillage = villages.find(v => {
                    const vOccupied = Array.isArray(v.housing_slots) ? v.housing_slots.length : 0;
                    return vOccupied < v.housing_capacity;
                });
                if (!availableVillage) break; // No available

                // Queue residency update
                residencyUpdates.push({ personId: person.id, newResidency: availableVillage.id });

                // Track slot changes
                if (!villageSlotUpdates.has(village.id)) {
                    villageSlotUpdates.set(village.id, { add: [], remove: [], currentSlots: village.housing_slots || [] });
                }
                villageSlotUpdates.get(village.id).remove.push(person.id);

                if (!villageSlotUpdates.has(availableVillage.id)) {
                    villageSlotUpdates.set(availableVillage.id, { add: [], remove: [], currentSlots: availableVillage.housing_slots || [] });
                }
                villageSlotUpdates.get(availableVillage.id).add.push(person.id);

                // Update local copies for subsequent calculations in this loop
                village.housing_slots = (village.housing_slots || []).filter(id => id != person.id);
                availableVillage.housing_slots = [...(availableVillage.housing_slots || []), person.id];
            }
        }

        // Then, assign unassigned adults
        const unassignedAdults = tilePeople.filter(person => {
            if (person.residency !== null && person.residency !== 0) return false;
            if (!person.date_of_birth) return false;
            const age = calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
            return age >= 18;
        });

        if (unassignedAdults.length > 0) {
            let peopleIndex = 0;

            for (const village of villages) {
                const currentOccupied = Array.isArray(village.housing_slots) ? village.housing_slots.length : 0;
                const available = village.housing_capacity - currentOccupied;

                if (available <= 0 || peopleIndex >= unassignedAdults.length) continue;

                const toAssign = Math.min(available, unassignedAdults.length - peopleIndex);
                const assignedPeople = unassignedAdults.slice(peopleIndex, peopleIndex + toAssign);

                // Queue residency updates
                for (const person of assignedPeople) {
                    residencyUpdates.push({ personId: person.id, newResidency: village.id });
                }

                // Track slot additions
                if (!villageSlotUpdates.has(village.id)) {
                    villageSlotUpdates.set(village.id, { add: [], remove: [], currentSlots: village.housing_slots || [] });
                }
                villageSlotUpdates.get(village.id).add.push(...assignedPeople.map(p => p.id));

                // Update local
                village.housing_slots = [...(village.housing_slots || []), ...assignedPeople.map(p => p.id)];

                peopleIndex += toAssign;
            }
        }

        // Execute batch residency update
        if (residencyUpdates.length > 0) {
            await PopulationState.batchUpdateResidency(residencyUpdates);
        }

        // Update village slots (still needs individual updates due to complex slot logic)
        for (const [villageId, changes] of villageSlotUpdates) {
            let finalSlots = changes.currentSlots.filter(id => !changes.remove.includes(id));
            finalSlots = [...finalSlots, ...changes.add];
            await StateManager.updateVillage(villageId, { housing_slots: finalSlots });
        }
    } catch (error) {
        console.error('Error assigning residency to adults:', error);
    }
}
