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
        if (!storage.isAvailable()) {
            // Storage may not yet be ready (e.g., Redis connecting). Wait briefly for a 'ready' event
            if (serverConfig.verboseLogs) console.log('[clearStoragePopulation] storage not available, waiting for ready event...');
            await Promise.race([
                new Promise(resolve => storage.on('ready', resolve)),
                new Promise(resolve => setTimeout(resolve, 5000))
            ]);
            if (!storage.isAvailable()) {
                console.warn('[clearStoragePopulation] storage remained unavailable after waiting; skipping clear');
                return;
            }
        }

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
        if (serverConfig.verboseLogs) console.log('[resetAllPopulation] Attempting to truncate people and families tables...');
        // Clear storage population data first
        await clearStoragePopulation();
        // Truncate people and family tables to clear all data and reset sequences.
        await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');
        if (serverConfig.verboseLogs) console.log('[resetAllPopulation] Truncate successful. Broadcasting update...');
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

        // Check if population already exists in Redis - if so, and per-tile data is present, don't reinitialize.
        const existingCount = await PopulationState.getTotalPopulation();
        if (existingCount > 0) {
            // Log the raw counts and tile keys for diagnostics
            let populations;
            try {
                populations = await PopulationState.getAllTilePopulations();
            } catch (e) {
                populations = {};
            }
            const tilesFound = populations && Object.keys(populations).length ? Object.keys(populations).length : 0;

            if (tilesFound > 0) {
                if (serverConfig.verboseLogs) console.log(`[PopulationOperations] Found ${existingCount} existing people in Redis and ${tilesFound} populated tiles. Using existing population.`);
                return {
                    success: true,
                    message: `Using existing population data (${existingCount} people)`,
                    isExisting: true,
                    ...formatPopulationData(populations)
                };
            }

            // If we have a total count but no per-tile breakdown, that's inconsistent - try to rebuild village membership sets from the person hash
            console.warn('[PopulationOperations] Inconsistent storage state: counts exist but no per-tile populations. Attempting to rebuild village membership sets from person hash...');
            try {
                const rebuildRes = await PopulationState.rebuildVillageMemberships();
                if (rebuildRes && rebuildRes.success && rebuildRes.total > 0) {
                    const repaired = await PopulationState.getAllTilePopulations();
                    if (repaired && Object.keys(repaired).length > 0) {
                        return {
                            success: true,
                            message: `Using repaired population data (${existingCount} people)`,
                            isExisting: true,
                            ...formatPopulationData(repaired)
                        };
                    }
                }
                console.warn('[PopulationOperations] rebuildVillageMemberships did not produce per-tile populations; continuing with initialization.');
            } catch (e) {
                console.warn('[PopulationOperations] rebuildVillageMemberships failed:', e && e.message ? e.message : e);
            }
        }

        if (serverConfig.verboseLogs) console.log('[PopulationOperations] No existing population found. Proceeding with storage-first initialization...');

        // Fetch habitable tiles from the database
        const habitableResult = await pool.query(`SELECT id FROM tiles WHERE is_habitable = TRUE`);
        const habitableFromDb = habitableResult.rows.map(r => r.id);
        const candidateTiles = Array.isArray(tileIds) && tileIds.length > 0
            ? tileIds.filter(id => habitableFromDb.includes(id))
            : habitableFromDb;

        // Select up to 5 random tiles for initialization (faster restart, multi-tile seeding)
        const shuffled = candidateTiles.sort(() => 0.5 - Math.random());
        const selectedTiles = shuffled.slice(0, 5);
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
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Clearing data...');
        await clearStoragePopulation();
        await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Clear done in ${Date.now() - startTime}ms`);

        // Get current date from calendar service - if missing, use system date to avoid invalid historical years
        let currentDate;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        } else {
            const now = new Date();
            currentDate = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
            console.warn('[PopulationOperations] CalendarService not available. Using system date as fallback:', currentDate);
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;
        const { getRandomSex, getRandomAge, getRandomBirthDate } = require('./calculator.js');

        // ========== Pre-allocate IDs dynamically per tile ==========
        const idAllocator = require('../idAllocator');

        let allPeople = []; // Array of person objects with real IDs
        const tilePopulationMap = {}; // tile_id -> array of person objects
        const tilePopulationTargets = {}; // tile_id -> target population per tile (500-5000)

        for (const tile_id of selectedTiles) {
            const tilePopulation = Math.floor(500 + Math.random() * 4501); // 500-5000 per tile
            // Use more conservative buffer for large populations to save memory
            const bufferMultiplier = tilePopulation > 10000 ? 1.5 : 2.5;
            const estimatedTilePeople = Math.ceil(tilePopulation * bufferMultiplier);
            const tilePersonIds = await idAllocator.getPersonIdBatch(estimatedTilePeople);
            let tilePersonIndex = 0;

            tilePopulationMap[tile_id] = [];
            // Track the intended target population for this tile (used to prevent over-allocation)
            tilePopulationTargets[tile_id] = tilePopulation;
            const minBachelorsPerSex = Math.floor(tilePopulation * 0.15);

            // Add guaranteed eligible males (16-45)
            for (let i = 0; i < minBachelorsPerSex; i++) {
                const age = 16 + Math.floor(Math.random() * 30);
                const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                const person = {
                    id: tilePersonIds[tilePersonIndex++],
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
                    id: tilePersonIds[tilePersonIndex++],
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
                    id: tilePersonIds[tilePersonIndex++],
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

        // Allocate family IDs based on actual people count
        const estimatedFamilyCount = Math.ceil(allPeople.length * 0.3);
        const familyIds = await idAllocator.getFamilyIdBatch(estimatedFamilyCount);
        let familyIdIndex = 0;

        // ========== Step 2: Create families in memory ==========
        const step2Start = Date.now();
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Step 2: Creating families in memory...');

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
                const familyId = familyIds[familyIdIndex++];

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

            // Randomly seed pregnancies for a percentage of families
            // e.g., 10% of families start pregnant
            const PREGNANCY_SEED_RATE = 0.10;
            for (const family of tileFamilies) {
                if (Math.random() < PREGNANCY_SEED_RATE) {
                    family.pregnancy = true;
                    // Optionally set a random delivery date within the next 8-32 days
                    const daysUntilDelivery = 8 + Math.floor(Math.random() * 25); // 8-32 days
                    const delivery = new Date(currentYear, currentMonth - 1, currentDay);
                    delivery.setDate(delivery.getDate() + daysUntilDelivery);
                    family.delivery_date = delivery.toISOString().split('T')[0];
                }
            }

            // --- FORCE AVG 4 CHILDREN PER FAMILY WITH VARIANCE 0-10 ---
            if (tileFamilies.length > 0) {
                // Assign each family a random number of children between 0 and 10
                // but guarantee the average is as close as possible to 4
                let childrenCounts = [];
                let totalFamilies = tileFamilies.length;
                let totalChildren = 0;
                // First, assign random children counts
                for (let i = 0; i < totalFamilies; i++) {
                    const n = Math.floor(Math.random() * 11); // 0-10 inclusive
                    childrenCounts.push(n);
                    totalChildren += n;
                }
                // Calculate adjustment needed
                const desiredTotal = totalFamilies * 4;
                let diff = desiredTotal - totalChildren;
                // Adjust up or down to hit the target average
                while (diff !== 0) {
                    if (diff > 0) {
                        // Add 1 child to a random family below 10
                        const candidates = childrenCounts.map((c, idx) => c < 10 ? idx : -1).filter(idx => idx !== -1);
                        if (candidates.length === 0) break;
                        const idx = candidates[Math.floor(Math.random() * candidates.length)];
                        childrenCounts[idx]++;
                        diff--;
                    } else {
                        // Remove 1 child from a random family above 0
                        const candidates = childrenCounts.map((c, idx) => c > 0 ? idx : -1).filter(idx => idx !== -1);
                        if (candidates.length === 0) break;
                        const idx = candidates[Math.floor(Math.random() * candidates.length)];
                        childrenCounts[idx]--;
                        diff++;
                    }
                }
                // Now generate and assign minors
                let minors = tilePeople.filter(p => {
                    const age = getAge(p.date_of_birth);
                    return age < 16 && p.family_id === null;
                });
                // Compute how many new minors we *can* add without exceeding base tilePopulation
                let needed = childrenCounts.reduce((a, b) => a + b, 0) - minors.length;
                const targetForTile = tilePopulationTargets[tile_id];
                const allowedNew = Math.max(0, (typeof targetForTile === 'number' ? targetForTile : Number.MAX_SAFE_INTEGER) - tilePeople.length);
                needed = Math.min(needed, allowedNew);
                if (needed > 0) {
                    const newIds = await idAllocator.getPersonIdBatch(needed);
                    for (let j = 0; j < needed; j++) {
                        const age = Math.floor(Math.random() * 16);
                        const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
                        const person = {
                            id: newIds[j],
                            tile_id,
                            residency: 0,
                            sex: getRandomSex(),
                            date_of_birth: birthDate,
                            family_id: null
                        };
                        allPeople.push(person);
                        tilePeople.push(person);
                        minors.push(person);
                    }
                }
                // If we couldn't add enough minors due to tile population cap, reduce childrenCounts to fit available minors
                const totalChildrenNeeded = childrenCounts.reduce((a, b) => a + b, 0);
                if (minors.length < totalChildrenNeeded) {
                    if (serverConfig.verboseLogs) console.warn(`[Tile ${tile_id}] Not enough minors to satisfy childrenCounts (${minors.length} available, ${totalChildrenNeeded} requested). Reducing childrenCounts.`);
                    // Reduce from families with highest child counts first
                    const countsWithIndex = childrenCounts.map((c, idx) => ({ c, idx }));
                    countsWithIndex.sort((a, b) => b.c - a.c);
                    let remaining = minors.length;
                    for (const entry of countsWithIndex) {
                        const take = Math.min(entry.c, Math.max(0, remaining));
                        childrenCounts[entry.idx] = take;
                        remaining -= take;
                        if (remaining <= 0) break;
                    }
                }

                // Assign minors to families according to childrenCounts
                let minorIdx = 0;
                for (let f = 0; f < tileFamilies.length; f++) {
                    for (let c = 0; c < childrenCounts[f]; c++) {
                        const child = minors[minorIdx++];
                        if (!child) continue; // defensive: skip if missing
                        child.family_id = tileFamilies[f].id;
                        tileFamilies[f].children_ids.push(child.id);
                    }
                }
                if (serverConfig.verboseLogs) console.log(`[Tile ${tile_id}] Assigned children to families (avg 4, 0-10 variance).`);

                // Safety: ensure we did not exceed the intended tilePopulation -- trim excess if any
                const target = tilePopulationTargets ? tilePopulationTargets[tile_id] : undefined;
                if (typeof target !== 'undefined' && tilePeople.length > target) {
                    const excess = tilePeople.length - target;
                    if (serverConfig.verboseLogs) console.warn(`[Tile ${tile_id}] Population exceeded target by ${excess}. Trimming ${excess} extras.`);
                    // Remove last `excess` people from tilePeople and allPeople
                    const removed = tilePeople.splice(tilePeople.length - excess, excess);
                    for (const p of removed) {
                        const idx = allPeople.findIndex(ap => ap.id === p.id);
                        if (idx !== -1) allPeople.splice(idx, 1);
                        // If any family contains these ids, remove from children lists
                        for (const f of allFamilies) {
                            if (f && Array.isArray(f.children_ids)) {
                                const ci = f.children_ids.indexOf(p.id);
                                if (ci !== -1) f.children_ids.splice(ci, 1);
                            }
                        }
                    }
                }
            }
            // --- END FORCE AVG 4 CHILDREN PER FAMILY WITH VARIANCE 0-10 ---
        }
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Step 2 done: ${allFamilies.length} families created in ${Date.now() - step2Start}ms`);

        // ========== Step 3: Write all data to Redis ==========
        const step3Start = Date.now();
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Step 3: Writing to storage...');

        // Use batch operations for Redis - dynamic batch size based on total people
        const numBatches = Math.min(20, Math.ceil(allPeople.length / 1000)); // Aim for ~1000-2000 per batch, up to 20 batches
        const BATCH_SIZE = Math.ceil(allPeople.length / numBatches);

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

        // ========== Integrity verification & optional repair (delegated) ==========
        try {
            const { verifyAndRepairIntegrity } = require('./integrity');
            const checkRes = await verifyAndRepairIntegrity(pool, selectedTiles, tilePopulationTargets, { repair: serverConfig.integrityRepairOnInit });
            if (!checkRes.ok) {
                console.warn('[initPop] Integrity check reported problems:', checkRes.details);
                if (serverConfig.integrityFailOnInit) {
                    throw new Error('Initialization aborted due to integrity check failures');
                }
            }
        } catch (err) {
            console.error('[initPop] Integrity verification failed:', err.message || err);
            if (serverConfig.integrityFailOnInit) {
                throw err;
            }
        }

        // Optionally persist the storage-first population to Postgres so stats remain available
        try {
            if (serverConfig.savePopulationOnInit) {
                if (serverConfig.verboseLogs) console.log('[initPop] Persisting population to Postgres via savePopulationData()...');
                const { savePopulationData } = require('./dataOperations.js');
                const saveRes = await savePopulationData();
                if (serverConfig.verboseLogs) console.log('[initPop] savePopulationData result:', saveRes);
            }
        } catch (e) {
            console.warn('[initPop] savePopulationData failed:', e && e.message ? e.message : e);
        }

        // Wait for storage to reflect all intended tiles (helps avoid returning a partial view if writes were batched)
        try {
            const waitStart = Date.now();
            const MAX_WAIT_MS = 5000; // total timeout waiting for all tiles
            const POLL_MS = 200;
            let allFound = false;
            while (Date.now() - waitStart < MAX_WAIT_MS) {
                const current = await PopulationState.getAllTilePopulations();
                const keys = Object.keys(current);
                allFound = selectedTiles.every(tid => keys.includes(String(tid)) || keys.includes(tid));
                if (allFound) break;
                // Small backoff
                await new Promise(resolve => setTimeout(resolve, POLL_MS));
            }
            if (!allFound) {
                console.warn('[initPop] Timeout waiting for all selected tiles to appear in storage. Proceeding with best-effort data.');
            } else if (serverConfig.verboseLogs) {
                console.log('[initPop] All selected tiles detected in storage after', Date.now() - waitStart, 'ms');
            }
        } catch (e) {
            console.warn('[initPop] Error while waiting for selected tiles in storage:', e && e.message ? e.message : e);
        }

        // ========== Return formatted result ==========
        const totalTime = Date.now() - startTime;
        if (serverConfig.verboseLogs) console.log(`✅ [initPop] COMPLETE: ${allPeople.length} people, ${allFamilies.length} families in ${totalTime}ms (storage-first, persisted to Postgres if enabled)`);

        // Prefer to return authoritative populations from storage if available; if we persisted to Postgres during init,
        // use loadPopulationData(pool) which will fall back to Postgres when necessary (ensures consumers see population data even if storage was cleared during save)
        let populations;
        try {
            const { loadPopulationData } = require('./dataOperations.js');
            populations = await loadPopulationData(pool);
        } catch (e) {
            // Fallback to storage read (best-effort)
            populations = await PopulationState.getAllTilePopulations();
        }

        // Sanity check: ensure per-tile populations match intended targets
        const mismatches = [];
        for (const tid of selectedTiles) {
            const actual = populations[tid] || 0;
            const intended = tilePopulationTargets[tid];
            if (typeof intended !== 'undefined' && actual !== intended) {
                mismatches.push({ tile: tid, intended, actual });
            }
        }
        if (mismatches.length > 0) {
            console.warn('[initPop] Population mismatches detected:', mismatches.slice(0, 10));
        }

        // Notify listeners/UI that population data changed so front-end can refresh
        try {
            if (serviceInstance && typeof serviceInstance.broadcastUpdate === 'function') {
                await serviceInstance.broadcastUpdate('populationUpdate');
            }
        } catch (e) {
            console.warn('[initPop] broadcastUpdate failed:', e && e.message ? e.message : e);
        }

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
