// Family Management - Handles family creation, pregnancy, and child management
const { calculateAge } = require('./calculator.js');

/**
 * Creates a new family unit - Redis-only, batched to Postgres on Save
 * @param {Pool} pool - Database pool instance (unused, kept for API compatibility)
 * @param {number} husbandId - ID of the husband
 * @param {number} wifeId - ID of the wife
 * @param {number} tileId - Tile ID where the family resides
 * @returns {Object} Created family record
 */
async function createFamily(pool, husbandId, wifeId, tileId) {
    try {
        const PopulationState = require('../populationState');

        // Verify both people exist in Redis
        const husband = await PopulationState.getPerson(husbandId);
        const wife = await PopulationState.getPerson(wifeId);

        if (!husband || !wife) {
            throw new Error('Both husband and wife must exist');
        }

        if (husband.sex !== true || wife.sex !== false) {
            throw new Error('Husband must be male and wife must be female');
        }

        // Get a temporary family ID (negative to distinguish from Postgres IDs)
        const familyId = await PopulationState.getNextFamilyTempId();

        // Create family record in Redis (will be batched to Postgres on Save)
        const family = {
            id: familyId,
            husband_id: husbandId,
            wife_id: wifeId,
            tile_id: tileId,
            pregnancy: false,
            delivery_date: null,
            children_ids: []
        };
        await PopulationState.addFamily(family, true); // isNew = true

        // Update both people in Redis to link them to their new family
        await PopulationState.updatePerson(husbandId, { family_id: familyId });
        await PopulationState.updatePerson(wifeId, { family_id: familyId });

        return family;
    } catch (error) {
        console.error('Error creating family:', error);
        throw error;
    }
}

/**
 * Starts pregnancy for a family - Redis-only
 * @param {Pool} pool - Database pool instance (unused, kept for API compatibility)
 * @param {Object} calendarService - Calendar service instance
 * @param {number} familyId - Family ID
 * @returns {Object} Updated family record
 */
async function startPregnancy(pool, calendarService, familyId) {
    const PopulationState = require('../populationState');
    try {
        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        // Get family from Redis
        const family = await PopulationState.getFamily(familyId);
        if (!family) {
            throw new Error(`Family ${familyId} not found`);
        }

        if (family.pregnancy) {
            throw new Error(`Family ${familyId} is already pregnant`);
        }

        // Get wife from Redis
        const wife = await PopulationState.getPerson(family.wife_id);
        if (!wife || !wife.date_of_birth) {
            throw new Error(`Wife ${family.wife_id} not found in Redis or missing birth date`);
        }

        const wifeBirthDate = wife.date_of_birth;

        // Calculate wife's age - handle both string and Date object formats
        let birthYear, birthMonth, birthDay;
        if (typeof wifeBirthDate === 'string') {
            const datePart = wifeBirthDate.split('T')[0];
            [birthYear, birthMonth, birthDay] = datePart.split('-').map(Number);
        } else if (wifeBirthDate instanceof Date) {
            birthYear = wifeBirthDate.getFullYear();
            birthMonth = wifeBirthDate.getMonth() + 1;
            birthDay = wifeBirthDate.getDate();
        } else {
            const dateStr = String(wifeBirthDate);
            [birthYear, birthMonth, birthDay] = dateStr.split('-').map(Number);
        }

        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;
        let wifeAge = currentYear - birthYear;
        if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
            wifeAge--;
        }

        // Check if wife is too old for pregnancy (limit: 33 years old)
        if (wifeAge > 33) {
            throw new Error(`Wife too old for pregnancy: age ${wifeAge} (limit 33)`);
        }

        // Calculate delivery date (approx 9 months later)
        const deliveryYear = currentDate.year;
        const deliveryMonth = currentDate.month + 9;
        const deliveryDay = currentDate.day;
        let finalMonth = deliveryMonth;
        let finalYear = deliveryYear;
        if (deliveryMonth > 12) {
            finalMonth = deliveryMonth - 12;
            finalYear = deliveryYear + 1;
        }
        const deliveryDate = `${finalYear}-${String(finalMonth).padStart(2, '0')}-${String(deliveryDay).padStart(2, '0')}`;

        // Update family in Redis
        await PopulationState.updateFamily(familyId, {
            pregnancy: true,
            delivery_date: deliveryDate
        });

        // Return updated family
        return { ...family, pregnancy: true, delivery_date: deliveryDate };
    } catch (error) {
        console.error(`Error starting pregnancy for family ${familyId}:`, error.message || error);
        throw error;
    }
}

/**
 * Delivers a baby and adds to family - Redis-only (Postgres writes happen on Save)
 * @param {Pool} pool - Database pool instance (used for family queries only)
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {number} familyId - Family ID
 * @returns {Object} Result with baby and updated family
 */
async function deliverBaby(pool, calendarService, populationServiceInstance, familyId) {
    try {
        const PopulationState = require('../populationState');
        const { isRedisAvailable } = require('../../config/redis');

        if (!isRedisAvailable()) {
            throw new Error('Redis not available - cannot deliver baby');
        }

        // Get family record from Redis
        const family = await PopulationState.getFamily(familyId);
        if (!family) {
            throw new Error('Family not found');
        }

        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;
        const birthDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;

        // Create baby
        const { getRandomSex } = require('./calculator.js');
        const babySex = getRandomSex();

        // Get father's residency to assign to baby (from Redis)
        let babyResidency = 0;
        if (family.husband_id) {
            const fatherFromRedis = await PopulationState.getPerson(family.husband_id);
            if (fatherFromRedis) {
                babyResidency = fatherFromRedis.residency || 0;
            }
        }

        // Get a temporary ID for Redis-only storage
        const babyId = await PopulationState.getNextTempId();

        const personObj = {
            id: babyId,
            tile_id: family.tile_id,
            residency: babyResidency,
            sex: babySex,
            date_of_birth: birthDate,
            health: 100,
            family_id: familyId
        };

        // Add baby to Redis with isNew=true for batch Postgres insert
        await PopulationState.addPerson(personObj, true);

        // Update family record in Redis with new baby
        const updatedChildrenIds = [...(family.children_ids || []), babyId];
        await PopulationState.updateFamily(familyId, { children_ids: updatedChildrenIds });

        // Track birth
        if (populationServiceInstance && typeof populationServiceInstance.trackBirths === 'function') {
            populationServiceInstance.trackBirths(1);
        }

        return {
            baby: { id: babyId, sex: babySex, birthDate },
            family: { ...family, children_ids: updatedChildrenIds }
        };
    } catch (error) {
        console.error('Error delivering baby:', error);
        throw error;
    }
}

/**
 * Gets all families on a specific tile - from Redis
 * @param {Pool} pool - Database pool instance (kept for API compatibility)
 * @param {number} tileId - Tile ID
 * @returns {Array} Array of family records
 */
async function getFamiliesOnTile(pool, tileId) {
    try {
        const PopulationState = require('../populationState');
        const allFamilies = await PopulationState.getAllFamilies();
        return allFamilies.filter(f => f.tile_id === tileId);
    } catch (error) {
        console.error('Error getting families on tile:', error);
        return [];
    }
}

/**
 * Checks for families ready to deliver and processes births - Redis-only
 * @param {Pool} pool - Database pool instance (kept for API compatibility)
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @returns {number} Number of babies born
 */
async function processDeliveries(pool, calendarService, populationServiceInstance) {
    try {
        const PopulationState = require('../populationState');

        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year, month, day } = currentDate;
        const currentDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const currentDateValue = new Date(currentDateStr).getTime();

        // Find families ready to deliver from Redis
        const allFamilies = await PopulationState.getAllFamilies();
        const readyFamilies = allFamilies.filter(f => {
            if (!f.pregnancy || !f.delivery_date) return false;
            const deliveryValue = new Date(f.delivery_date.split('T')[0]).getTime();
            return deliveryValue <= currentDateValue;
        });

        let babiesDelivered = 0;
        for (const family of readyFamilies) {
            try {
                // Re-verify family still exists (may have been reassigned during save)
                const currentFamily = await PopulationState.getFamily(family.id);
                if (!currentFamily) {
                    // Family ID was likely reassigned during save, skip silently
                    continue;
                }
                // Clear pregnancy status in Redis before delivery
                await PopulationState.updateFamily(family.id, { pregnancy: false, delivery_date: null });
                await deliverBaby(pool, calendarService, populationServiceInstance, family.id);
                babiesDelivered++;
            } catch (error) {
                // Suppress "Family not found" errors (race condition with save)
                if (!error.message.includes('Family not found')) {
                    console.error(`Error delivering baby for family ${family.id}:`, error);
                }
            }
        }

        if (babiesDelivered > 0) {
            // Quiet: babies delivered today (log suppressed)
        }

        return babiesDelivered;
    } catch (error) {
        console.error('Error processing deliveries:', error);
        return 0;
    }
}

/**
 * Gets family statistics - from Redis
 * @param {Pool} pool - Database pool instance (kept for API compatibility)
 * @returns {Object} Family statistics
 */
async function getFamilyStats(pool) {
    try {
        const PopulationState = require('../populationState');
        const allFamilies = await PopulationState.getAllFamilies();

        const totalFamilies = allFamilies.length;
        const pregnantFamilies = allFamilies.filter(f => f.pregnancy).length;
        const totalChildren = allFamilies.reduce((sum, f) => sum + (f.children_ids?.length || 0), 0);
        const avgChildrenPerFamily = totalFamilies > 0 ? totalChildren / totalFamilies : 0;

        return {
            totalFamilies,
            pregnantFamilies,
            avgChildrenPerFamily
        };
    } catch (error) {
        console.error('Error getting family stats:', error);
        return {
            totalFamilies: 0,
            pregnantFamilies: 0,
            avgChildrenPerFamily: 0
        };
    }
}

/**
 * Forms new families from eligible bachelors - uses Redis for people data
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @returns {number} Number of new families formed
 */
async function formNewFamilies(pool, calendarService) {
    try {
        const PopulationState = require('../populationState');
        const { calculateAge } = require('./calculator.js');

        // Get current calendar date for age calculations
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year, month, day } = currentDate;

        // Get all people from Redis
        const allPeople = await PopulationState.getAllPeople();

        // Filter eligible bachelors from Redis data
        const eligibleMales = [];
        const eligibleFemales = [];

        for (const person of allPeople) {
            // Skip if already in a family
            if (person.family_id) continue;
            if (!person.date_of_birth) continue;

            const age = calculateAge(person.date_of_birth, year, month, day);

            if (person.sex === true && age >= 16 && age <= 45) {
                eligibleMales.push(person);
            } else if (person.sex === false && age >= 16 && age <= 30) {
                eligibleFemales.push(person);
            }
        }

        // Shuffle for randomness
        eligibleMales.sort(() => Math.random() - 0.5);
        eligibleFemales.sort(() => Math.random() - 0.5);

        if (eligibleMales.length === 0 || eligibleFemales.length === 0) {
            return 0;
        }

        // Group people by tile to only allow same-tile marriages
        const malesByTile = {};
        const femalesByTile = {};

        eligibleMales.forEach(male => {
            if (!malesByTile[male.tile_id]) malesByTile[male.tile_id] = [];
            malesByTile[male.tile_id].push(male);
        });

        eligibleFemales.forEach(female => {
            if (!femalesByTile[female.tile_id]) femalesByTile[female.tile_id] = [];
            femalesByTile[female.tile_id].push(female);
        });

        let newFamiliesCount = 0;
        const usedMales = new Set();
        const usedFemales = new Set();

        // Only same-tile marriages: match people from the same tile only
        for (const tileId of Object.keys(malesByTile)) {
            const tiledMales = malesByTile[tileId];
            const tiledFemales = femalesByTile[tileId] || [];

            if (tiledFemales.length === 0) {
                console.log(`   Tile ${tileId}: ${tiledMales.length} eligible males but no eligible females`);
                continue;
            }

            const pairs = Math.min(tiledMales.length, tiledFemales.length);
            console.log(`   Tile ${tileId}: Forming ${pairs} families from ${tiledMales.length} males and ${tiledFemales.length} females`);

            for (let i = 0; i < pairs; i++) {
                const male = tiledMales[i];
                const female = tiledFemales[i];

                if (!usedMales.has(male.id) && !usedFemales.has(female.id)) {
                    try {
                        // createFamily now returns the family with its (temp) ID
                        const newFamily = await createFamily(pool, male.id, female.id, parseInt(tileId));
                        usedMales.add(male.id);
                        usedFemales.add(female.id);
                        newFamiliesCount++;

                        // Higher chance to start immediate pregnancy (40% - increased to boost birth rates to 40 per 1000 per year)
                        if (Math.random() < 0.40) {
                            await startPregnancy(pool, calendarService, newFamily.id);
                        }
                    } catch (error) {
                        console.error(`Error creating family between ${male.id} and ${female.id} on tile ${tileId}:`, error);
                    }
                }
            }
        }

        // Report any remaining singles who couldn't find partners on their tile
        const remainingMales = eligibleMales.filter(m => !usedMales.has(m.id));
        const remainingFemales = eligibleFemales.filter(f => !usedFemales.has(f.id));

        if (remainingMales.length > 0 || remainingFemales.length > 0) {
            console.log(`   ⚠️  ${remainingMales.length} males and ${remainingFemales.length} females remain single (no eligible partners on their tile)`);
        }

        if (newFamiliesCount > 0) {
            console.log(`💒 Formed ${newFamiliesCount} new families (same-tile marriages only)`);
        }

        return newFamiliesCount;
    } catch (error) {
        console.error('Error forming new families:', error);
        return 0;
    }
}

module.exports = {
    createFamily,
    startPregnancy,
    deliverBaby,
    getFamiliesOnTile,
    processDeliveries,
    getFamilyStats,
    formNewFamilies
};
