// Family Management - Handles family creation, pregnancy, and child management
const { calculateAge } = require('./calculator.js');
const storage = require('../storage');
const serverConfig = require('../../config/server.js');

// Delivery retry configuration - read from serverConfig at runtime to allow tests to modify values in beforeEach

/**
 * Creates a new family unit - storage-only, batched to Postgres on Save
 * @param {Pool} pool - Database pool instance (unused, kept for API compatibility)
 * @param {number} husbandId - ID of the husband
 * @param {number} wifeId - ID of the wife
 * @param {number} tileId - Tile ID where the family resides
 * @returns {Object} Created family record
 */
async function createFamily(pool, husbandId, wifeId, tileId) {
    const { acquireLock, releaseLock } = require('../../utils/lock');
    const PopulationState = require('../populationState');
    const coupleKeyParts = [husbandId, wifeId].map(id => Number(id)).sort((a, b) => a - b);
    const lockKey = `lock:couple:${coupleKeyParts[0]}:${coupleKeyParts[1]}`;
    let lockToken = null;

    try {
        // Skip if restart is in progress
        if (PopulationState.isRestarting) {
            return null;
        }

        // Acquire a lock for this couple to avoid duplicate family creation
        lockToken = await acquireLock(lockKey, 3000, 1500, 40);
        if (!lockToken) {
            try { await storage.incr('stats:matchmaking:contention'); } catch (_) { }
            console.warn(`[createFamily] Could not acquire couple lock for ${husbandId} & ${wifeId} - skipping`);
            return null;
        }

        // Verify both people exist in Redis
        const husband = await PopulationState.getPerson(husbandId);
        const wife = await PopulationState.getPerson(wifeId);

        if (!husband || !wife) {
            // Silently return null during restart/clear operations instead of throwing
            return null;
        }

        // Ensure neither already belongs to a family (double-check under lock)
        if (husband.family_id || wife.family_id) {
            console.warn(`[createFamily] Husband ${husbandId} or wife ${wifeId} already in a family - skipping`);
            return null;
        }

        // Use truthy comparison for sex field (handles string/boolean variants from Redis)
        const husbandIsMale = husband.sex === true || husband.sex === 'true' || husband.sex === 1;
        const wifeIsFemale = wife.sex === false || wife.sex === 'false' || wife.sex === 0;
        if (!husbandIsMale || !wifeIsFemale) {
            throw new Error('Husband must be male and wife must be female');
        }

        // Get a real Postgres ID for the new family (pre-allocated from sequence)
        const familyId = await PopulationState.getNextFamilyId();

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

        // Remove both partners from eligible matchmaking sets (defensive)
        try {
            await PopulationState.removeEligiblePerson(husbandId, tileId, 'male');
        } catch (e) { console.warn('[createFamily] removeEligiblePerson failed for husband:', e && e.message ? e.message : e); }
        try {
            await PopulationState.removeEligiblePerson(wifeId, tileId, 'female');
        } catch (e) { console.warn('[createFamily] removeEligiblePerson failed for wife:', e && e.message ? e.message : e); }

        return family;
    } catch (error) {
        console.error('Error creating family:', error);
        throw error;
    } finally {
        if (lockToken) {
            try { await releaseLock(lockKey, lockToken); } catch (e) { console.warn('[createFamily] failed to release lock:', e && e.message ? e.message : e); }
        }
    }
}

/**
 * Starts pregnancy for a family - storage-only
 * @param {Pool} pool - Database pool instance (unused, kept for API compatibility)
 * @param {Object} calendarService - Calendar service instance
 * @param {number} familyId - Family ID
 * @returns {Object} Updated family record
 */
async function startPregnancy(pool, calendarService, familyId) {
    const PopulationState = require('../populationState');
    const { acquireLock, releaseLock } = require('../../utils/lock');
    const lockKey = `lock:family:${familyId}`;
    let lockToken = null;

    try {
        // Record an attempt
        try { await storage.incr('stats:pregnancy:attempts'); } catch (_) { }

        // Skip if restart is in progress
        if (PopulationState.isRestarting) {
            return null;
        }

        // Try to acquire an atomic lock for this family to avoid concurrent pregnancies
        // Increased TTL/timeout/retry to reduce spurious contention under load
        lockToken = await acquireLock(lockKey, 10000, 5000, 100);
        if (!lockToken) {
            try { await storage.incr('stats:pregnancy:contention'); } catch (_) { }
            // Attempt to inspect current lock holder (if using Redis) to aid debugging
            try {
                const adapter = storage.getAdapter ? storage.getAdapter() : storage;
                const holder = adapter && adapter.client && typeof adapter.client.get === 'function' ? await adapter.client.get(lockKey) : null;
                console.warn(`[startPregnancy] Could not acquire lock for family ${familyId} - holder=${holder || 'unknown'} - another operation in progress`);
            } catch (e) {
                console.warn(`[startPregnancy] Could not acquire lock for family ${familyId} - another operation in progress (could not inspect holder)`);
            }
            return null;
        }

        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        // Get family from Redis
        const family = await PopulationState.getFamily(familyId);
        if (!family) {
            // Silently return null during restart/clear operations
            return null;
        }

        // Double-check pregnancy state under the lock (prevents races)
        if (family.pregnancy) {
            console.warn(`Family ${familyId} is already pregnant - skipping startPregnancy`);
            return null;
        }

        // Get wife from Redis
        const wife = await PopulationState.getPerson(family.wife_id);
        if (!wife || !wife.date_of_birth) {
            // Silently return null during restart/clear operations
            return null;
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

        // Remove family from fertile set so it is not considered for concurrent pregnancies
        try { await PopulationState.removeFertileFamily(familyId); } catch (_) { }

        // Return updated family
        return { ...family, pregnancy: true, delivery_date: deliveryDate };
    } catch (error) {
        console.error(`Error starting pregnancy for family ${familyId}:`, error.message || error);
        throw error;
    } finally {
        // Release lock if it was acquired
        if (lockToken) {
            try {
                await releaseLock(lockKey, lockToken);
            } catch (e) {
                console.warn(`[startPregnancy] Failed releasing lock for family ${familyId}:`, e && e.message ? e.message : e);
            }
        }
    }
}

/**
 * Delivers a baby and adds to family - storage-only (Postgres writes happen on Save)
 * @param {Pool} pool - Database pool instance (used for family queries only)
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {number} familyId - Family ID
 * @returns {Object} Result with baby and updated family
 */
async function deliverBaby(pool, calendarService, populationServiceInstance, familyId) {
    const { acquireLock, releaseLock } = require('../../utils/lock');
    const lockKey = `lock:family:${familyId}`;
    let lockToken = null;

    try {
        // Acquire lock to ensure single delivery per family
        // Use server-configurable timeouts so tests can control contention behaviour
        const lockTtl = serverConfig.deliveryLockTtlMs ?? 10000;
        const lockTimeout = serverConfig.deliveryLockAcquireTimeoutMs ?? 0; // immediate fail on contention by default
        const lockRetryDelay = serverConfig.deliveryLockRetryDelayMs ?? 0;
        lockToken = await acquireLock(lockKey, lockTtl, lockTimeout, lockRetryDelay);
        if (!lockToken) {
            try { await storage.incr('stats:deliveries:contention'); } catch (_) { }
            try {
                const adapter = storage.getAdapter ? storage.getAdapter() : storage;
                const holder = adapter && adapter.client && typeof adapter.client.get === 'function' ? await adapter.client.get(lockKey) : null;
                console.warn(`[deliverBaby] Could not acquire lock for family ${familyId} - holder=${holder || 'unknown'} - skipping delivery`);
            } catch (e) {
                console.warn(`[deliverBaby] Could not acquire lock for family ${familyId} - skipping delivery (could not inspect holder)`);
            }
            return null;
        }

        const PopulationState = require('../populationState');

        if (!storage.isAvailable()) {
            throw new Error('Storage not available - cannot deliver baby');
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

        // Get a temporary ID for storage-only mode
        const babyId = await PopulationState.getNextId();

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

        // Record delivery metric
        try { await storage.incr('stats:deliveries:count'); } catch (_) { }

        return {
            baby: { id: babyId, sex: babySex, birthDate },
            family: { ...family, children_ids: updatedChildrenIds }
        };
    } catch (error) {
        console.error('Error delivering baby:', error);
        throw error;
    } finally {
        if (lockToken) {
            try { await releaseLock(lockKey, lockToken); } catch (e) { console.warn('[deliverBaby] failed to release lock:', e && e.message ? e.message : e); }
        }
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
 * Checks for families ready to deliver and processes births - storage-only
 * @param {Pool} pool - Database pool instance (kept for API compatibility)
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {number} daysAdvanced - Number of days passed in this tick (for future use)
 * @returns {number} Number of babies born
 */
async function processDeliveries(pool, calendarService, populationServiceInstance, daysAdvanced = 1) {
    try {
        const PopulationState = require('../populationState');

        // Skip if restart is in progress
        if (PopulationState.isRestarting) {
            return 0;
        }

        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year, month, day } = currentDate;
        const currentDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const currentDateValue = new Date(currentDateStr).getTime();

        // Collect retry candidates that are scheduled for immediate retry
        let retryCandidateIds = [];
        try {
            const due = await storage.zrangebyscore('pending:deliveries:retry', 0, Date.now());
            if (due && due.length > 0) {
                retryCandidateIds = due.map(id => parseInt(id, 10));
                // remove them from the retry zset (we'll re-attempt now)
                for (const id of due) {
                    try { await storage.zrem('pending:deliveries:retry', id); } catch (_) { }
                }
            }
        } catch (e) { /* ignore */ }

        // Prefer consuming from the global fertile queue if storage supports it, otherwise fall back to scanning
        let readyFamilies = [];
        if (storage.isAvailable() && typeof storage.atomicPopDueFertile === 'function') {
            // First, requeue any retry candidates we collected earlier (they were already removed from retry zset)
            // Now pop due items from the global queue until exhausted
            while (true) {
                const id = await storage.atomicPopDueFertile(Date.now());
                if (!id) break;
                try {
                    const f = await PopulationState.getFamily(parseInt(id, 10));
                    if (f) readyFamilies.push(f);
                } catch (e) { /* ignore */ }
            }
            // Also append retryCandidateIds that may have come from earlier code path
            for (const id of retryCandidateIds) {
                try { const f = await PopulationState.getFamily(id); if (f) readyFamilies.push(f); } catch (_) { }
            }
        } else {
            // Fallback: scan all families as before
            const allFamilies = await PopulationState.getAllFamilies();
            readyFamilies = allFamilies.filter(f => {
                if (!f.pregnancy || !f.delivery_date) return false;
                const deliveryValue = new Date(f.delivery_date.split('T')[0]).getTime();
                return deliveryValue <= currentDateValue;
            });
            for (const id of retryCandidateIds) {
                try { const f = await PopulationState.getFamily(id); if (f && !readyFamilies.find(r => r.id === f.id)) readyFamilies.push(f); } catch (_) { }
            }
        }

        let babiesDelivered = 0;
        for (const family of readyFamilies) {
            const { acquireLock, releaseLock } = require('../../utils/lock');
            const lockKey = `lock:family:${family.id}`;
            let lockToken = null;
            try {
                // Try to acquire a lock for this family to prevent concurrent deliveries
                // Increased TTL/timeout/retry to reduce contention under load
                lockToken = await acquireLock(lockKey, 10000, 5000, 100);
                if (!lockToken) {
                    try { await storage.incr('stats:deliveries:contention'); } catch (_) { }
                    // Increment retry attempts and schedule a retry if under the max attempts
                    try {
                        const attempts = await storage.hincrby('pending:delivery:attempts', String(family.id), 1);
                        const baseDelay = serverConfig.deliveryRetryDelayMs ?? 5000;
                        const retryMaxAttempts = serverConfig.deliveryRetryMaxAttempts ?? 5;
                        const backoffMultiplier = serverConfig.deliveryRetryBackoffMultiplier ?? 2;
                        if (attempts <= retryMaxAttempts) {
                            const delay = Math.round(baseDelay * Math.pow(serverConfig.deliveryRetryBackoffMultiplier || 2, attempts - 1));

                            await storage.zadd('pending:deliveries:retry', Date.now() + delay, String(family.id));
                            try { await storage.incr('stats:deliveries:retries'); } catch (_) { }
                            const adapter = storage.getAdapter ? storage.getAdapter() : storage;
                            const holder = adapter && adapter.client && typeof adapter.client.get === 'function' ? await adapter.client.get(lockKey) : null;
                            console.warn(`[processDeliveries] Could not acquire lock for family ${family.id} - requeued for retry (attempt ${attempts}, delay ${delay}ms) - holder=${holder || 'unknown'}`);
                        } else {
                            try { await storage.incr('stats:deliveries:permanent_failures'); } catch (_) { }
                            console.warn(`[processDeliveries] Family ${family.id} reached max delivery retry attempts (${attempts}) - skipping permanently`);
                        }
                    } catch (e) {
                        // Fallback: just log and skip this cycle
                        try {
                            const adapter = storage.getAdapter ? storage.getAdapter() : storage;
                            const holder = adapter && adapter.client && typeof adapter.client.get === 'function' ? await adapter.client.get(lockKey) : null;
                            console.warn(`[processDeliveries] Could not acquire lock for family ${family.id} - holder=${holder || 'unknown'} - skipping delivery this cycle`);
                        } catch (err) {
                            console.warn(`[processDeliveries] Could not acquire lock for family ${family.id} - skipping delivery this cycle (could not inspect holder)`);
                        }
                    }
                    continue;
                }

                // Re-verify family still exists (may have been reassigned during save)
                const currentFamily = await PopulationState.getFamily(family.id);
                if (!currentFamily) {
                    // Family ID was likely reassigned during save, skip silently
                    continue;
                }

                // Ensure the family is still marked as pregnant and due
                if (!currentFamily.pregnancy || !currentFamily.delivery_date) {
                    continue;
                }

                // Clear pregnancy status in Redis before delivery
                await PopulationState.updateFamily(family.id, { pregnancy: false, delivery_date: null });
                const res = await deliverBaby(pool, calendarService, populationServiceInstance, family.id);
                // After delivery, if still eligible, add back to fertile family set
                try {
                    if (res && res.family) {
                        const f = res.family;
                        // Check if wife still fertile and children < 5
                        const wife = await PopulationState.getPerson(f.wife_id);
                        if (wife && wife.date_of_birth) {
                            // get current date
                            const cd = calendarService && typeof calendarService.getCurrentDate === 'function' ? calendarService.getCurrentDate() : { year: 4000, month: 1, day: 1 };
                            await PopulationState.addFertileFamily(f.id, cd.year, cd.month, cd.day);
                        }
                    }
                } catch (e) { /* ignore */ }
                // Clear retry attempts and any queued retry entries after successful delivery
                try {
                    await storage.hdel('pending:delivery:attempts', String(family.id));
                    await storage.zrem('pending:deliveries:retry', String(family.id));
                } catch (_) { }
                babiesDelivered++;
            } catch (error) {
                // Suppress "Family not found" errors (race condition with save)
                if (!error.message.includes('Family not found')) {
                    console.error(`Error delivering baby for family ${family.id}:`, error);
                }
            } finally {
                if (lockToken) {
                    try { await releaseLock(lockKey, lockToken); } catch (e) { console.warn('[processDeliveries] failed to release lock:', e && e.message ? e.message : e); }
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

        // Skip if restart is in progress
        if (PopulationState.isRestarting) {
            return 0;
        }

        // Get current calendar date for age calculations
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year, month, day } = currentDate;

        // Use Redis-based eligible sets for faster matchmaking
        // Collect tiles that have eligible males or females
        const maleTiles = await storage.smembers('tiles_with_eligible_males');
        const femaleTiles = await storage.smembers('tiles_with_eligible_females');
        const tileSet = new Set([...(maleTiles || []), ...(femaleTiles || [])]);

        let newFamiliesCount = 0;

        for (const tileId of tileSet) {
            try {
                const maleSetKey = `eligible:males:tile:${tileId}`;
                const femaleSetKey = `eligible:females:tile:${tileId}`;

                // Check approximate counts
                const maleCount = parseInt(await storage.scard(maleSetKey), 10) || 0;
                const femaleCount = parseInt(await storage.scard(femaleSetKey), 10) || 0;

                if (maleCount === 0 || femaleCount === 0) {
                    // Nothing to do on this tile
                    continue;
                }

                const pairs = Math.min(maleCount, femaleCount);
                if (serverConfig.verboseLogs) console.log(`   Tile ${tileId}: Attempting up to ${pairs} pairings (${maleCount} males, ${femaleCount} females)`);

                for (let i = 0; i < pairs; i++) {
                    // Record attempt
                    try { await storage.incr('stats:matchmaking:attempts'); } catch (_) { }

                    // Pop one candidate from each set (emulate spop using smembers + srem)
                    const maleMembers = await storage.smembers(maleSetKey);
                    const maleId = (maleMembers && maleMembers.length > 0) ? maleMembers[Math.floor(Math.random() * maleMembers.length)] : null;
                    if (!maleId) break; // no more males
                    await storage.srem(maleSetKey, maleId);

                    const femaleMembers = await storage.smembers(femaleSetKey);
                    const femaleId = (femaleMembers && femaleMembers.length > 0) ? femaleMembers[Math.floor(Math.random() * femaleMembers.length)] : null;
                    if (!femaleId) {
                        // Put male back and stop trying for this tile now
                        await storage.sadd(maleSetKey, maleId);
                        break;
                    }

                    // Attempt to create family
                    try {
                        const newFamily = await createFamily(pool, parseInt(maleId), parseInt(femaleId), parseInt(tileId));
                        if (!newFamily) {
                            // Creation failed (race or restart) - return survivors to sets
                            try { await storage.sadd(maleSetKey, maleId); } catch (_) { }
                            try { await storage.sadd(femaleSetKey, femaleId); } catch (_) { }
                            continue;
                        }
                        // Add family to fertile family set if wife is fertile
                        try {
                            await PopulationState.addFertileFamily(newFamily.id, year, month, day);
                        } catch (_) { }

                        newFamiliesCount++;

                        // 40% chance to start immediate pregnancy
                        if (Math.random() < 0.40) {
                            try { await startPregnancy(pool, calendarService, newFamily.id); } catch (e) { /* ignore */ }
                        }
                    } catch (err) {
                        try { await storage.incr('stats:matchmaking:failures'); } catch (_) { }
                        console.error(`Error creating family between ${maleId} and ${femaleId} on tile ${tileId}:`, err);
                        // Return survivors to sets
                        try { await storage.sadd(maleSetKey, maleId); } catch (_) { }
                        try { await storage.sadd(femaleSetKey, femaleId); } catch (_) { }
                    }
                }
            } catch (err) {
                console.warn('[formNewFamilies] Error processing tile:', tileId, err && err.message ? err.message : err);
            }
        }

        // Note: with Redis-based matchmaking we don't perform a full scan report of remaining singles here.
        // Per-tile eligible sets may contain remaining members; monitor with metrics if needed.

        if (newFamiliesCount > 0) {
            if (serverConfig.verboseLogs) console.log(`💒 Formed ${newFamiliesCount} new families (same-tile marriages only)`);
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
