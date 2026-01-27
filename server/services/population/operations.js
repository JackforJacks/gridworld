// Population Operations - Handles population manipulation and management
const { addPeopleToTile, removePeopleFromTile } = require('./manager.js');
const { ensureTableExists } = require('./initializer.js');
const { Procreation } = require('./family.js');

/**
 * Clears all population data from Redis
 */
async function clearRedisPopulation() {
    try {
        const { isRedisAvailable } = require('../../config/redis');
        if (!isRedisAvailable()) return;
        
        const redis = require('../../config/redis');
        // Clear person hash
        await redis.del('person');
        // Clear all village:*:*:people sets
        const stream = redis.scanStream({ match: 'village:*:*:people', count: 1000 });
        const keys = [];
        for await (const resultKeys of stream) {
            for (const key of resultKeys) keys.push(key);
        }
        if (keys.length > 0) await redis.del(...keys);
        // Reset counts
        await redis.del('counts:global');
        console.log('[clearRedisPopulation] Cleared Redis population data');
    } catch (err) {
        console.warn('[clearRedisPopulation] Failed to clear Redis:', err.message);
    }
}

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
        // Clear Redis population data first
        await clearRedisPopulation();
        // Truncate people and family tables to clear all data and reset sequences.
        await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');
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

        // Check if population already exists - if so, don't reinitialize
        const existingPeopleResult = await pool.query('SELECT COUNT(*) as count FROM people');
        const existingPeopleCount = parseInt(existingPeopleResult.rows[0].count);

        if (existingPeopleCount > 0) {
            console.log(`[PopulationOperations] Found ${existingPeopleCount} existing people. Using existing population instead of reinitializing.`);
            const populations = await loadPopulationData(pool);
            return {
                success: true,
                message: `Using existing population data (${existingPeopleCount} people)`,
                isExisting: true,
                ...formatPopulationData(populations)
            };
        }
        console.log('[PopulationOperations] No existing population found. Proceeding with initialization...');

        // Fetch habitable tiles from the database to ensure we only initialize on tiles marked habitable
        const habitableResult = await pool.query(`SELECT id FROM tiles WHERE is_habitable = TRUE`);
        const habitableFromDb = habitableResult.rows.map(r => r.id);
        // Intersect with provided tileIds if provided, otherwise use DB list
        const candidateTiles = Array.isArray(tileIds) && tileIds.length > 0
            ? tileIds.filter(id => habitableFromDb.includes(id))
            : habitableFromDb;

        // Select only up to 10 random tiles for initialization
        const shuffled = candidateTiles.sort(() => 0.5 - Math.random());
        const selectedTiles = shuffled.slice(0, 10);
        console.log(`[PopulationOperations] Selected ${selectedTiles.length} random tiles for initialization (from DB habitable list):`, selectedTiles);

        if (selectedTiles.length === 0) {
            console.warn('[PopulationOperations] initializeTilePopulations: No tiles selected.');
            return {
                success: false,
                message: 'No tiles selected',
                tilePopulations: {},
                totalPopulation: 0,
                totalTiles: 0,
                lastUpdated: new Date().toISOString()
            };
        }

        // Clear Redis population data first
        await clearRedisPopulation();
        await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');

        // Get current date from calendar service
        let currentDate;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        } else {
            console.warn('[PopulationOperations] CalendarService not available. Using fallback date.');
            currentDate = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;

        for (const tile_id of selectedTiles) {
            // Generate population around 3000 people per tile (2500-3500 range)
            const tilePopulation = Math.floor(2500 + Math.random() * 1001);
            const minBachelorsPerSex = Math.floor(tilePopulation * 0.15); // 15% of population are eligible bachelors of each sex
            const people = [];
            // Add guaranteed eligible males (16-45)
            for (let i = 0; i < minBachelorsPerSex; i++) {
                const age = 16 + Math.floor(Math.random() * 30); // 16-45
                const sex = true; // male
                const birthDate = require('./calculator.js').getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                people.push([tile_id, sex, birthDate]);
            }
            // Add guaranteed eligible females (16-30)
            for (let i = 0; i < minBachelorsPerSex; i++) {
                const age = 16 + Math.floor(Math.random() * 15); // 16-30
                const sex = false; // female
                const birthDate = require('./calculator.js').getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                people.push([tile_id, sex, birthDate]);
            }
            // Fill the rest of the population randomly
            const remaining = tilePopulation - people.length;
            const { getRandomSex, getRandomAge, getRandomBirthDate } = require('./calculator.js');
            for (let i = 0; i < remaining; i++) {
                const sex = getRandomSex();
                const age = getRandomAge();
                const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                people.push([tile_id, sex, birthDate]);
            }
            // Batch insert all people for this tile, explicitly setting family_id to NULL
            if (people.length > 0) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const batchSize = 100;
                    for (let i = 0; i < people.length; i += batchSize) {
                        const batch = people.slice(i, i + batchSize).map(p => [...p, null]); // add null for family_id
                        const values = batch.map((person, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4})`).join(',');
                        const flatBatch = batch.flat();
                        await client.query(`INSERT INTO people (tile_id, sex, date_of_birth, family_id) VALUES ${values}`, flatBatch);
                    }
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            }
            // Log inserted people for this tile
            // const inserted = await pool.query(`SELECT id, sex, date_of_birth, family_id FROM people WHERE tile_id = $1`, [tile_id]);
            // Debug: print actual ages of all inserted people
            // const debugAges = inserted.rows.map(p => {
            //     const birthYear = p.date_of_birth instanceof Date
            //         ? p.date_of_birth.getFullYear()
            //         : parseInt(String(p.date_of_birth).split('-')[0], 10);
            //     const age = currentYear - birthYear;
            //     return { id: p.id, sex: p.sex ? 'M' : 'F', age, family_id: p.family_id };
            // });
            // console.log(`[Tile ${tile_id}] Inserted people ages:`, debugAges);
            // const allMales = inserted.rows.filter(p => p.sex === true);
            // const eligibleMales = allMales.filter(p => {
            //     const birthYear = p.date_of_birth instanceof Date
            //         ? p.date_of_birth.getFullYear()
            //         : parseInt(String(p.date_of_birth).split('-')[0], 10);
            //     const age = currentYear - birthYear;
            //     return age >= 16 && age <= 45 && p.family_id === null;
            // });
            // const allFemales = inserted.rows.filter(p => p.sex === false);
            // const eligibleFemales = allFemales.filter(p => {
            //     const birthYear = p.date_of_birth instanceof Date
            //         ? p.date_of_birth.getFullYear()
            //         : parseInt(String(p.date_of_birth).split('-')[0], 10);
            //     const age = currentYear - birthYear;
            //     return age >= 16 && age <= 30 && p.family_id === null;
            // });
            // console.log(`[Tile ${tile_id}] Inserted: total=${inserted.rows.length}, eligible males=${eligibleMales.length}, eligible females=${eligibleFemales.length}`);

            // --- NEW LOGIC: Pair 80% of bachelors and assign minors ---
            // 1. Get eligible bachelors (men 16-45, women 16-30, not in a family)
            const simDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
            const bachelorsResult = await pool.query(`
                SELECT id, sex, date_of_birth FROM people
                WHERE tile_id = $1
                  AND ((sex = TRUE AND EXTRACT(YEAR FROM AGE($2::date, date_of_birth)) BETWEEN 16 AND 45)
                       OR (sex = FALSE AND EXTRACT(YEAR FROM AGE($2::date, date_of_birth)) BETWEEN 16 AND 30))
                  AND family_id IS NULL
                ORDER BY RANDOM()
            `, [tile_id, simDate]);
            const bachelors = bachelorsResult.rows;
            // Split by sex
            const bachelorMales = bachelors.filter(b => b.sex === true);
            const bachelorFemales = bachelors.filter(b => b.sex === false);
            // Pair up as many as possible, up to 80% of the smaller group
            const pairCount = Math.floor(Math.min(bachelorMales.length, bachelorFemales.length) * 0.8);
            console.log(`[Tile ${tile_id}] Eligible bachelors: males=${bachelorMales.length}, females=${bachelorFemales.length}, pairs to create=${pairCount}`);
            for (let i = 0; i < pairCount; i++) {
                // Create a family for each pair in the 'family' table
                const familyInsert = await pool.query(`
                    INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, children_ids)
                    VALUES ($1, $2, $3, FALSE, '{}') RETURNING id
                `, [bachelorMales[i].id, bachelorFemales[i].id, tile_id]);
                const famId = familyInsert.rows[0].id;
                // Update people.family_id for both husband and wife
                await pool.query('UPDATE people SET family_id = $1 WHERE id = $2', [famId, bachelorMales[i].id]);
                await pool.query('UPDATE people SET family_id = $1 WHERE id = $2', [famId, bachelorFemales[i].id]);
                // console.log(`[Tile ${tile_id}] 🎉 New family created after initialization: id=${famId}, male=${bachelorMales[i].id}, female=${bachelorFemales[i].id}`);
            }
            // 2. Assign all minors to these new families (distribute evenly)
            const minorsResult = await pool.query(`
                SELECT id FROM people
                WHERE tile_id = $1
                  AND EXTRACT(YEAR FROM AGE(date_of_birth)) < 16
                  AND family_id IS NULL
            `, [tile_id]);
            const minors = minorsResult.rows;
            // Get the new families created on this tile
            const newFamiliesResult = await pool.query(`
                SELECT id FROM family WHERE id > (SELECT COALESCE(MIN(id),0) FROM family) ORDER BY id DESC LIMIT $1
            `, [pairCount]);
            const newFamilyIds = newFamiliesResult.rows.map(r => r.id);
            // Distribute minors round-robin to families, only if there are families
            if (newFamilyIds.length > 0) {
                for (let i = 0; i < minors.length; i++) {
                    const famId = newFamilyIds[i % newFamilyIds.length];
                    await pool.query('UPDATE people SET family_id = $1 WHERE id = $2', [famId, minors[i].id]);
                }
                console.log(`[Tile ${tile_id}] Assigned ${minors.length} minors to ${newFamilyIds.length} new families.`);
            } else {
                console.log(`[Tile ${tile_id}] No new families created, minors not assigned.`);
            }
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
        // Clear Redis population data first
        await clearRedisPopulation();
        await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');

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
