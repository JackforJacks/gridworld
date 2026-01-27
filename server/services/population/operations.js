// Population Operations - Handles population manipulation and management
const { addPeopleToTile, removePeopleFromTile } = require('./manager.js');
const { ensureTableExists } = require('./initializer.js');
const { Procreation } = require('./family.js');
const serverConfig = require('../../config/server');
const storage = require('../storage');

/**
 * Clears all population data from storage
 */
async function clearStoragePopulation() {
    try {
        if (!storage.isAvailable()) return;

        // Clear person hash
        await storage.del('person');
        // Clear all village:*:*:people sets
        const stream = storage.scanStream({ match: 'village:*:*:people', count: 1000 });
        const keys = [];
        for await (const resultKeys of stream) {
            for (const key of resultKeys) keys.push(key);
        }
        if (keys.length > 0) await storage.del(...keys);
        // Reset counts
        await storage.del('counts:global');
        if (serverConfig.verboseLogs) console.log('[clearStoragePopulation] Cleared storage population data');
    } catch (err) {
        console.warn('[clearStoragePopulation] Failed to clear storage:', err.message);
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
        // Clear storage population data first
        await clearStoragePopulation();
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
    if (serverConfig.verboseLogs) console.log('[PopulationOperations] initializeTilePopulations called with tileIds:', tileIds);
    const startTime = Date.now();

    try {
        // Import validation and data operations
        const { validateTileIds } = require('./validation.js');
        const { formatPopulationData } = require('./dataOperations.js');
        const PopulationState = require('../populationState.js');

        validateTileIds(tileIds);

        // Check if population already exists in Redis - if so, don't reinitialize
        const existingCount = await PopulationState.getTotalPopulation();
        if (existingCount > 0) {
            if (serverConfig.verboseLogs) console.log(`[PopulationOperations] Found ${existingCount} existing people in Redis. Using existing population.`);
            const populations = await PopulationState.getAllTilePopulations();
            return {
                success: true,
                message: `Using existing population data (${existingCount} people)`,
                isExisting: true,
                ...formatPopulationData(populations)
            };
        }
        if (serverConfig.verboseLogs) console.log('[PopulationOperations] No existing population found. Proceeding with storage-first initialization...');

        // Fetch habitable tiles from the database
        const habitableResult = await pool.query(`SELECT id FROM tiles WHERE is_habitable = TRUE`);
        const habitableFromDb = habitableResult.rows.map(r => r.id);
        const candidateTiles = Array.isArray(tileIds) && tileIds.length > 0
            ? tileIds.filter(id => habitableFromDb.includes(id))
            : habitableFromDb;

        // Select only up to 10 random tiles for initialization
        const shuffled = candidateTiles.sort(() => 0.5 - Math.random());
        const selectedTiles = shuffled.slice(0, 10);
        if (serverConfig.verboseLogs) console.log(`[PopulationOperations] Selected ${selectedTiles.length} random tiles for initialization:`, selectedTiles);

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

        // Clear storage population data and Postgres tables
        console.log('⏱️ [initPop] Clearing data...');
        await clearStoragePopulation();
        await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');
        console.log(`⏱️ [initPop] Clear done in ${Date.now() - startTime}ms`);

        // Get current date from calendar service
        let currentDate;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        } else {
            console.warn('[PopulationOperations] CalendarService not available. Using fallback date.');
            currentDate = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;
        const { getRandomSex, getRandomAge, getRandomBirthDate } = require('./calculator.js');

        // ========== STORAGE-FIRST: Generate all people in memory ==========
        const step1Start = Date.now();
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Step 1: Generating people data in memory...');

        let personIdCounter = 1;
        const allPeople = []; // Array of person objects with temp IDs
        const tilePopulationMap = {}; // tile_id -> array of person objects

        for (const tile_id of selectedTiles) {
            const tilePopulation = Math.floor(2500 + Math.random() * 1001);
            tilePopulationMap[tile_id] = [];
            const minBachelorsPerSex = Math.floor(tilePopulation * 0.15);

            // Add guaranteed eligible males (16-45)
            for (let i = 0; i < minBachelorsPerSex; i++) {
                const age = 16 + Math.floor(Math.random() * 30);
                const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                const person = {
                    id: personIdCounter++,
                    tile_id,
                    residency: 0,
                    sex: true,
                    date_of_birth: birthDate,
                    family_id: null
                };
                allPeople.push(person);
                tilePopulationMap[tile_id].push(person);
            }
            // Add guaranteed eligible females (16-30)
            for (let i = 0; i < minBachelorsPerSex; i++) {
                const age = 16 + Math.floor(Math.random() * 15);
                const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                const person = {
                    id: personIdCounter++,
                    tile_id,
                    residency: 0,
                    sex: false,
                    date_of_birth: birthDate,
                    family_id: null
                };
                allPeople.push(person);
                tilePopulationMap[tile_id].push(person);
            }
            // Fill the rest randomly
            const remaining = tilePopulation - (minBachelorsPerSex * 2);
            for (let i = 0; i < remaining; i++) {
                const sex = getRandomSex();
                const age = getRandomAge();
                const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                const person = {
                    id: personIdCounter++,
                    tile_id,
                    residency: 0,
                    sex,
                    date_of_birth: birthDate,
                    family_id: null
                };
                allPeople.push(person);
                tilePopulationMap[tile_id].push(person);
            }
        }
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Step 1 done: ${allPeople.length} people generated in ${Date.now() - step1Start}ms`);

        // ========== Step 2: Create families in memory ==========
        const step2Start = Date.now();
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Step 2: Creating families in memory...');

        let familyIdCounter = 1;
        const allFamilies = [];

        // Calculate age for matching
        const getAge = (birthDate) => {
            const [year, month, day] = birthDate.split('-').map(Number);
            let age = currentYear - year;
            if (currentMonth < month || (currentMonth === month && currentDay < day)) {
                age--;
            }
            return age;
        };

        for (const tile_id of selectedTiles) {
            const tilePeople = tilePopulationMap[tile_id];

            // Find eligible bachelors
            const eligibleMales = tilePeople.filter(p => {
                if (!p.sex || p.family_id !== null) return false;
                const age = getAge(p.date_of_birth);
                return age >= 16 && age <= 45;
            });

            const eligibleFemales = tilePeople.filter(p => {
                if (p.sex || p.family_id !== null) return false;
                const age = getAge(p.date_of_birth);
                return age >= 16 && age <= 30;
            });

            // Shuffle for random pairing
            eligibleMales.sort(() => Math.random() - 0.5);
            eligibleFemales.sort(() => Math.random() - 0.5);

            const pairCount = Math.floor(Math.min(eligibleMales.length, eligibleFemales.length) * 0.8);
            if (serverConfig.verboseLogs) console.log(`[Tile ${tile_id}] Eligible: males=${eligibleMales.length}, females=${eligibleFemales.length}, pairs=${pairCount}`);

            const tileFamilies = [];
            for (let i = 0; i < pairCount; i++) {
                const husband = eligibleMales[i];
                const wife = eligibleFemales[i];
                const familyId = familyIdCounter++;

                const family = {
                    id: familyId,
                    husband_id: husband.id,
                    wife_id: wife.id,
                    tile_id,
                    pregnancy: false,
                    delivery_date: null,
                    children_ids: []
                };

                // Update person family_ids in memory
                husband.family_id = familyId;
                wife.family_id = familyId;

                tileFamilies.push(family);
                allFamilies.push(family);
            }

            // Assign minors to families
            if (tileFamilies.length > 0) {
                const minors = tilePeople.filter(p => {
                    const age = getAge(p.date_of_birth);
                    return age < 16 && p.family_id === null;
                });

                for (let i = 0; i < minors.length; i++) {
                    const family = tileFamilies[i % tileFamilies.length];
                    minors[i].family_id = family.id;
                    family.children_ids.push(minors[i].id);
                }
                if (serverConfig.verboseLogs) console.log(`[Tile ${tile_id}] Assigned ${minors.length} minors to ${tileFamilies.length} families.`);
            }
        }
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Step 2 done: ${allFamilies.length} families created in ${Date.now() - step2Start}ms`);

        // ========== Step 3: Write all data to Redis ==========
        const step3Start = Date.now();
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Step 3: Writing to storage...');

        // Use batch operations for Redis
        const BATCH_SIZE = 500;

        // Add all people to Redis with isNew=true (marks as pending insert)
        for (let i = 0; i < allPeople.length; i += BATCH_SIZE) {
            const batch = allPeople.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(person => PopulationState.addPerson(person, true)));
        }
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Added ${allPeople.length} people to storage`);

        // Add all families to Redis with isNew=true (marks as pending insert)
        for (let i = 0; i < allFamilies.length; i += BATCH_SIZE) {
            const batch = allFamilies.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(family => PopulationState.addFamily(family, true)));
        }
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Added ${allFamilies.length} families to storage`);

        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Step 3 done: storage write completed in ${Date.now() - step3Start}ms`);

        // ========== Return formatted result ==========
        const totalTime = Date.now() - startTime;
        if (serverConfig.verboseLogs) console.log(`✅ [initPop] COMPLETE: ${allPeople.length} people, ${allFamilies.length} families in ${totalTime}ms (storage-only, pending Postgres save)`);

        const populations = await PopulationState.getAllTilePopulations();
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
        // Clear storage population data first
        await clearStoragePopulation();
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
