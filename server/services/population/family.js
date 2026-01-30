// Population Family Operations - Enhanced with family table integration
const { addPeopleToTile, removePeopleFromTile } = require('./manager.js');
const deps = require('./dependencyContainer');

/**
 * Enhanced Procreation function with family management
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {number} tileId - The tile ID
 * @param {number} population - Target population
 */
async function Procreation(pool, calendarService, populationServiceInstance, tileId, population) {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM people WHERE tile_id = $1', [tileId]);
        const currentCount = parseInt(result.rows[0].count, 10);

        let calendarDateToUse;
        if (calendarService && typeof calendarService.getState === 'function') {
            const calendarState = calendarService.getState();
            if (calendarState && calendarState.currentDate) {
                calendarDateToUse = calendarState.currentDate;
            } else {
                console.warn('[family.js.Procreation] CalendarService.getState() did not return a valid currentDate. Using an absolute fallback (Year 1, Month 1, Day 1).');
                calendarDateToUse = { year: 1, month: 1, day: 1 };
            }
        } else {
            console.warn('[family.js.Procreation] CalendarService not available or getState is not a function. Using an absolute fallback (Year 1, Month 1, Day 1).');
            calendarDateToUse = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = calendarDateToUse;

        if (population > currentCount) {
            const birthCount = population - currentCount;

            // Try to handle births through existing families first
            await processDeliveries(pool, calendarService, populationServiceInstance);

            // Check if we still need more people after deliveries
            const updatedResult = await pool.query('SELECT COUNT(*) FROM people WHERE tile_id = $1', [tileId]);
            const updatedCount = parseInt(updatedResult.rows[0].count, 10);
            const remainingNeeded = population - updatedCount;

            if (remainingNeeded > 0) {
                await addPeopleToTile(pool, tileId, remainingNeeded, currentYear, currentMonth, currentDay, populationServiceInstance, true);

                // Potentially create new families from new adults
                await createRandomFamilies(pool, tileId);
            }
        } else if (population < currentCount) {
            const deathCount = currentCount - population;
            await removePeopleFromTile(pool, tileId, deathCount, populationServiceInstance, true);
        }

        if (populationServiceInstance && typeof populationServiceInstance.broadcastUpdate === 'function') {
            await populationServiceInstance.broadcastUpdate('populationUpdate');
        } else {
            console.warn('[family.js.Procreation] populationServiceInstance.broadcastUpdate is not a function. Update not broadcasted.');
        }
    } catch (error) {
        console.error(`[family.js.Procreation] Error updating population for tile ${tileId}:`, error);
        throw error;
    }
}

/**
 * Creates random families from available adults on a tile
 * @param {Pool} pool - Database pool instance
 * @param {number} tileId - The tile ID
 * @param {Object} calendarService - Calendar service to get current simulation date
 */
async function createRandomFamilies(pool, tileId, calendarService = null) {
    try {
        // Get current simulation date
        let cutoffDate;
        if (calendarService) {
            const currentDate = calendarService.getCurrentDate();
            const cutoffYear = currentDate.year - 18;
            cutoffDate = `${cutoffYear}-${String(currentDate.month).padStart(2, '0')}-${String(currentDate.day).padStart(2, '0')}`;
        } else {
            // Fallback to real date (shouldn't be used in simulation)
            const currentDate = new Date();
            const eighteenYearsAgo = new Date(currentDate.getFullYear() - 18, currentDate.getMonth(), currentDate.getDate());
            cutoffDate = eighteenYearsAgo.toISOString().split('T')[0];
        }

        console.log(`[family.js] Looking for adults born before ${cutoffDate} on tile ${tileId}`);

        const eligibleMales = await pool.query(`
            SELECT p.id FROM people p
            LEFT JOIN family f1 ON p.id = f1.husband_id
            LEFT JOIN family f2 ON p.id = f2.wife_id
            WHERE p.tile_id = $1 AND p.sex = TRUE AND p.date_of_birth <= $2
            AND f1.husband_id IS NULL AND f2.wife_id IS NULL
            ORDER BY RANDOM()
        `, [tileId, cutoffDate]);

        const eligibleFemales = await pool.query(`
            SELECT p.id FROM people p
            LEFT JOIN family f1 ON p.id = f1.husband_id
            LEFT JOIN family f2 ON p.id = f2.wife_id
            WHERE p.tile_id = $1 AND p.sex = FALSE AND p.date_of_birth <= $2
            AND f1.husband_id IS NULL AND f2.wife_id IS NULL
            ORDER BY RANDOM()
        `, [tileId, cutoffDate]);

        const males = eligibleMales.rows;
        const females = eligibleFemales.rows;
        const maxPairs = Math.min(males.length, females.length);

        // Create families with random pairing
        for (let i = 0; i < maxPairs && i < 5; i++) { // Limit to 5 new families per tile per update
            try {
                const { createFamily } = deps.getFamilyManager();
                const newFamily = await createFamily(pool, males[i].id, females[i].id, tileId);

                // If calendarService available, register the family as fertile candidate if applicable
                try {
                    if (newFamily && calendarService && typeof calendarService.getCurrentDate === 'function') {
                        const cd = calendarService.getCurrentDate();
                        const PopulationState = deps.getPopulationState();
                        await PopulationState.addFertileFamily(newFamily.id, cd.year, cd.month, cd.day);
                    }
                } catch (_) { }

                // 30% chance of immediate pregnancy for new families
                if (Math.random() < 0.3) {
                    const familyResult = await pool.query(
                        'SELECT id FROM family WHERE husband_id = $1 AND wife_id = $2',
                        [males[i].id, females[i].id]
                    );
                    if (familyResult.rows.length > 0) {
                        try {
                            const { startPregnancy } = deps.getFamilyManager();
                            await startPregnancy(pool, null, familyResult.rows[0].id);
                        } catch (err) {
                            console.warn(`[family.createRandomFamilies] startPregnancy failed for family ${familyResult.rows[0].id}: ${err.message || err}`);
                        }
                    }
                }
            } catch (error) {
                console.warn(`Failed to create family: ${error.message}`);
            }
        }
    } catch (error) {
        console.error('Error creating random families:', error);
    }
}

module.exports = {
    Procreation,
    createRandomFamilies,
    // Re-export family management functions (lazy-loaded to avoid circular deps)
    get createFamily() { return deps.getFamilyManager().createFamily; },
    get startPregnancy() { return deps.getFamilyManager().startPregnancy; },
    get deliverBaby() { return deps.getFamilyManager().deliverBaby; },
    get processDeliveries() { return deps.getFamilyManager().processDeliveries; },
    get getFamiliesOnTile() { return deps.getFamilyManager().getFamiliesOnTile; }
};
