// State Manager Service
// Handles syncing state between Redis (hot data) and PostgreSQL (persistence)
const redis = require('../config/redis');
const { isRedisAvailable } = require('../config/redis');
const pool = require('../config/database');

class StateManager {
    static io = null;
    static initialized = false;
    static calendarService = null;

    static setIo(io) {
        this.io = io;
    }

    static setCalendarService(calendarService) {
        this.calendarService = calendarService;
    }

    /**
     * Check if Redis is available
     */
    static isRedisAvailable() {
        return isRedisAvailable();
    }

    /**
     * Load all data from PostgreSQL into Redis on server start
     */
    static async loadFromDatabase() {
        if (!isRedisAvailable()) {
            console.warn('⚠️ Redis not available, skipping state load');
            return { villages: 0, people: 0, families: 0, skipped: true };
        }

        console.log('📥 Loading state from PostgreSQL to Redis...');
        // Clear existing Redis state keys to avoid stale data
        try {
            await redis.del('village', 'person', 'family', 'tile:fertility', 'village:cleared', 'counts:global', 'pending:inserts', 'pending:deletes', 'pending:family:inserts', 'pending:family:updates');
            // Also clear all village:*:*:people sets
            const stream = redis.scanStream({ match: 'village:*:*:people', count: 1000 });
            const keysToDelete = [];
            for await (const resultKeys of stream) {
                for (const key of resultKeys) keysToDelete.push(key);
            }
            if (keysToDelete.length > 0) {
                await redis.del(...keysToDelete);
            }
            console.log('🧹 Cleared existing Redis state keys (including counts:global, village sets, family, and pending ops)');
        } catch (e) {
            console.warn('⚠️ Failed to clear Redis keys before load:', e.message);
        }
        const pipeline = redis.pipeline();

        // Load villages
        const { rows: villages } = await pool.query('SELECT * FROM villages');
        for (const v of villages) {
            pipeline.hset('village', v.id.toString(), JSON.stringify({
                id: v.id,
                tile_id: v.tile_id,
                land_chunk_index: v.land_chunk_index,
                name: v.name,
                food_stores: parseFloat(v.food_stores) || 0,
                food_capacity: parseInt(v.food_capacity) || 1000,
                food_production_rate: parseFloat(v.food_production_rate) || 0,
                housing_capacity: parseInt(v.housing_capacity) || 100,
            }));
        }

        // Load people and count demographics
        const { rows: people } = await pool.query('SELECT * FROM people');
        let maleCount = 0, femaleCount = 0;
        for (const p of people) {
            // Normalize sex to boolean (Postgres may return it as string/int)
            const sex = p.sex === true || p.sex === 'true' || p.sex === 1 ? true : false;
            pipeline.hset('person', p.id.toString(), JSON.stringify({
                id: p.id,
                tile_id: p.tile_id,
                residency: p.residency,
                sex: sex,
                health: p.health ?? 100,
                family_id: p.family_id,
                date_of_birth: p.date_of_birth,
            }));
            // Index: which village does this person belong to?
            if (p.tile_id && p.residency !== null) {
                pipeline.sadd(`village:${p.tile_id}:${p.residency}:people`, p.id.toString());
            }
            // Count demographics
            if (sex === true) maleCount++;
            else femaleCount++;
        }

        // Load families
        const { rows: families } = await pool.query('SELECT * FROM family');
        for (const f of families) {
            pipeline.hset('family', f.id.toString(), JSON.stringify({
                id: f.id,
                husband_id: f.husband_id,
                wife_id: f.wife_id,
                tile_id: f.tile_id,
                pregnancy: f.pregnancy || false,
                delivery_date: f.delivery_date || null,
                children_ids: f.children_ids || [],
            }));
        }

        // After writing families into Redis, populate fertile family set based on current calendar
        try {
            // Build a map of people for quick lookup
            const peopleMap = {};
            for (const p of people) peopleMap[p.id] = p;

            let currentDate = { year: 1, month: 1, day: 1 };
            if (this.calendarService && typeof this.calendarService.getState === 'function') {
                const cs = this.calendarService.getState(); if (cs && cs.currentDate) currentDate = cs.currentDate;
            }

            const PopulationState = require('./populationState');
            for (const f of families) {
                try {
                    // Skip if already pregnant or too many children
                    const childrenCount = (f.children_ids || []).length;
                    if (f.pregnancy || childrenCount >= 5) continue;
                    const wife = peopleMap[f.wife_id];
                    if (!wife || !wife.date_of_birth) continue;
                    await PopulationState.addFertileFamily(f.id, currentDate.year, currentDate.month, currentDate.day);
                } catch (_) { }
            }
            console.log('✅ Populated fertile family candidates from loaded families');
        } catch (e) {
            console.warn('⚠️ Failed to populate fertile family sets on load:', e && e.message ? e.message : e);
        }

        // Get cleared land counts per village
        const { rows: landCounts } = await pool.query(`
            SELECT v.id as village_id, COUNT(*) as cleared_cnt
            FROM villages v
            JOIN tiles_lands tl ON tl.tile_id = v.tile_id 
                AND tl.chunk_index = v.land_chunk_index 
                AND tl.cleared = true
            GROUP BY v.id
        `);

        for (const lc of landCounts) {
            pipeline.hset('village:cleared', lc.village_id.toString(), lc.cleared_cnt.toString());
        }

        // Set global population counts for PopulationState compatibility
        pipeline.hset('counts:global', 'total', people.length.toString());
        pipeline.hset('counts:global', 'male', maleCount.toString());
        pipeline.hset('counts:global', 'female', femaleCount.toString());
        // Initialize temp ID counters for new Redis-only records
        pipeline.hset('counts:global', 'nextTempId', '-1');
        pipeline.hset('counts:global', 'nextFamilyTempId', '-1');

        await pipeline.exec();
        this.initialized = true;
        console.log(`✅ Loaded ${villages.length} villages, ${people.length} people (${maleCount} male, ${femaleCount} female), ${families.length} families to Redis`);

        // Populate eligible matchmaking sets based on loaded people
        try {
            const PopulationState = require('./populationState');
            let currentDate = { year: 1, month: 1, day: 1 };
            if (this.calendarService && typeof this.calendarService.getState === 'function') {
                const cs = this.calendarService.getState();
                if (cs && cs.currentDate) currentDate = cs.currentDate;
            }
            console.log('📅 [StateManager] Using calendar date for eligible sets:', currentDate);
            for (const p of people) {
                try {
                    await PopulationState.addEligiblePerson(p, currentDate.year, currentDate.month, currentDate.day);
                } catch (e) {
                    /* ignore individual failures */
                }
            }
            console.log('✅ Populated eligible candidate sets from loaded people');
        } catch (e) {
            console.warn('⚠️ Failed to populate eligible sets on load:', e && e.message ? e.message : e);
        }

        return { villages: villages.length, people: people.length, families: families.length, male: maleCount, female: femaleCount };
    }

    /**
     * Save all Redis state back to PostgreSQL (called on Save button click)
     * Handles: village updates, new person inserts, person deletes, person updates, family inserts/updates
     */
    static async saveToDatabase() {
        if (!this.isRedisAvailable()) {
            throw new Error('Redis is not available - cannot save in-memory state to database');
        }

        // Pause calendar ticks during save to prevent race conditions
        console.log(`💾 Calendar service available: ${!!this.calendarService}, isRunning: ${this.calendarService?.state?.isRunning}`);
        const wasRunning = this.calendarService?.state?.isRunning;
        if (wasRunning && this.calendarService) {
            console.log('⏸️ Pausing calendar for save...');
            this.calendarService.stop();
        }

        try {
            console.log('💾 [1/8] Saving Redis state to PostgreSQL...');
            const startTime = Date.now();
            const PopulationState = require('./populationState');

            // Save villages
            console.log('💾 [2/8] Getting village data...');
            const villageData = await redis.hgetall('village');
            const villageCount = Object.keys(villageData).length;
            console.log(`💾 [2/8] Got ${villageCount} villages`);

            // Handle pending village inserts (Redis-first villages need to be persisted)
            const pendingVillageIds = await PopulationState.getPendingVillageInserts();
            let villagesInserted = 0;
            const villageIdMappings = [];

            if (pendingVillageIds.length > 0) {
                console.log(`🏗️ Inserting ${pendingVillageIds.length} pending villages into PostgreSQL...`);
                for (const tempId of pendingVillageIds) {
                    try {
                        const json = villageData[tempId.toString()];
                        if (!json) continue;
                        const v = JSON.parse(json);
                        const insertResult = await pool.query(`
                            INSERT INTO villages (tile_id, land_chunk_index, name, housing_slots, housing_capacity, food_stores, food_capacity, food_production_rate)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                            RETURNING id
                        `, [v.tile_id, v.land_chunk_index, v.name, JSON.stringify(v.housing_slots || []), v.housing_capacity || 1000, v.food_stores || 0, v.food_capacity || 1000, v.food_production_rate || 0.5]);

                        const newId = insertResult.rows[0].id;
                        villageIdMappings.push({ tempId: parseInt(tempId, 10), newId });

                        // Associate tiles_lands with this new village id
                        try {
                            await pool.query(`UPDATE tiles_lands SET village_id = $1 WHERE tile_id = $2 AND chunk_index = $3`, [newId, v.tile_id, v.land_chunk_index]);
                        } catch (e) { /* non-fatal */ }

                        villagesInserted++;
                    } catch (err) {
                        console.warn('[stateManager] Failed to insert pending village:', err.message || err);
                    }
                }

                if (villageIdMappings.length > 0) {
                    await PopulationState.reassignVillageIds(villageIdMappings);
                    console.log(`🏗️ Reassigned ${villageIdMappings.length} village IDs in Redis`);
                }
                console.log(`🏗️ Inserted ${villagesInserted} villages into Postgres`);
            }

            // Now update existing villages' runtime fields (food stores, production)
            if (villageCount > 0) {
                const villageValues = [];
                for (const [id, json] of Object.entries(villageData)) {
                    const v = JSON.parse(json);
                    villageValues.push(`(${v.id}, ${v.food_stores}, ${v.food_production_rate})`);
                }

                console.log('💾 [2/8] Updating villages in Postgres...');
                await pool.query(`
                UPDATE villages AS v SET
                    food_stores = c.food_stores,
                    food_production_rate = c.food_production_rate,
                    updated_at = CURRENT_TIMESTAMP
                FROM (VALUES ${villageValues.join(',')}) AS c(id, food_stores, food_production_rate)
                WHERE v.id = c.id
            `);
                console.log('💾 [2/8] Villages updated');
            }

            // 1a. Process pending family deletes (families where a spouse died)
            console.log('💾 [3/8] Getting pending family deletes...');
            const pendingFamilyDeletes = await PopulationState.getPendingFamilyDeletes();
            console.log(`💾 [3/8] Found ${pendingFamilyDeletes.length} family deletes`);
            let familiesDeleted = 0;
            if (pendingFamilyDeletes.length > 0) {
                console.log(`🗑️ Deleting ${pendingFamilyDeletes.length} families from PostgreSQL...`);
                // Remove any fertile family records for these families
                try {
                    for (const fid of pendingFamilyDeletes) {
                        await redis.srem('eligible:pregnancy:families', fid.toString());
                    }
                } catch (_) { }
                // First clear family_id references in people table
                const famPlaceholders = pendingFamilyDeletes.map((_, idx) => `$${idx + 1}`).join(',');
                await pool.query(`UPDATE people SET family_id = NULL WHERE family_id IN (${famPlaceholders})`, pendingFamilyDeletes);
                // Then delete the families
                await pool.query(`DELETE FROM family WHERE id IN (${famPlaceholders})`, pendingFamilyDeletes);
                familiesDeleted = pendingFamilyDeletes.length;
            }

            // 1b. Process pending deletes (people who died)
            const pendingDeletes = await PopulationState.getPendingDeletes();
            let deletedCount = 0;
            if (pendingDeletes.length > 0) {
                console.log(`🗑️ Deleting ${pendingDeletes.length} people from PostgreSQL...`);
                const placeholders = pendingDeletes.map((_, idx) => `$${idx + 1}`).join(',');
                await pool.query(`DELETE FROM people WHERE id IN (${placeholders})`, pendingDeletes);
                deletedCount = pendingDeletes.length;
            }

            // 2. Process pending FAMILY inserts FIRST (before people, so family_ids are valid)
            console.log('💾 [5/8] Getting pending family inserts...');
            const pendingFamilyInserts = await PopulationState.getPendingFamilyInserts();
            console.log(`💾 [5/8] Found ${pendingFamilyInserts.length} family inserts`);
            let familiesInserted = 0;
            const familyIdMappings = [];

            if (pendingFamilyInserts.length > 0) {
                console.log(`👨‍👩‍👧 Inserting ${pendingFamilyInserts.length} new families into PostgreSQL...`);

                for (const f of pendingFamilyInserts) {
                    // Insert family with NULL for husband/wife IDs that are temp (negative)
                    // We'll update them after people are inserted
                    const husbandId = f.husband_id > 0 ? f.husband_id : null;
                    const wifeId = f.wife_id > 0 ? f.wife_id : null;

                    const insertResult = await pool.query(`
                    INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id
                `, [husbandId, wifeId, f.tile_id, f.pregnancy, f.delivery_date, f.children_ids || []]);

                    const newFamilyId = insertResult.rows[0].id;
                    familyIdMappings.push({ tempId: f.id, newId: newFamilyId });
                    familiesInserted++;
                }

                console.log('💾 [5/8] Reassigning family IDs in Redis...');
                // Reassign family IDs in Redis
                if (familyIdMappings.length > 0) {
                    await PopulationState.reassignFamilyIds(familyIdMappings);
                }
                console.log('💾 [5/8] Family IDs reassigned');
            }

            // 3. Process pending people inserts (new people - births, etc.)
            console.log('💾 [6/8] Getting pending people inserts...');
            const pendingInserts = await PopulationState.getPendingInserts();
            let insertedCount = 0;
            const idMappings = [];

            if (pendingInserts.length > 0) {
                console.log(`📥 Inserting ${pendingInserts.length} new people into PostgreSQL...`);
                const batchSize = 100;

                for (let i = 0; i < pendingInserts.length; i += batchSize) {
                    const batch = pendingInserts.slice(i, i + batchSize);
                    console.log(`   Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pendingInserts.length / batchSize)}: ${batch.length} people`);
                    const values = [];
                    const params = [];
                    let paramIdx = 1;

                    for (const p of batch) {
                        // Map temp family_id to real family_id if needed
                        let realFamilyId = p.family_id;
                        if (p.family_id && p.family_id < 0) {
                            const mapping = familyIdMappings.find(m => m.tempId === p.family_id);
                            if (mapping) realFamilyId = mapping.newId;
                            else realFamilyId = null;
                        }

                        values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`);
                        params.push(
                            p.tile_id,
                            p.sex,
                            p.date_of_birth,
                            p.residency,
                            realFamilyId
                        );
                        paramIdx += 5;
                    }

                    try {
                        const insertResult = await pool.query(`
                        INSERT INTO people (tile_id, sex, date_of_birth, residency, family_id)
                        VALUES ${values.join(',')}
                        RETURNING id
                    `, params);

                        // Map temp IDs to new Postgres IDs
                        for (let j = 0; j < batch.length; j++) {
                            const tempId = batch[j].id;
                            const newId = insertResult.rows[j].id;
                            idMappings.push({ tempId, newId });
                        }
                        insertedCount += batch.length;
                        console.log(`   Batch insert complete: ${insertedCount}/${pendingInserts.length}`);
                    } catch (insertErr) {
                        console.error(`❌ Batch insert failed:`, insertErr.message);
                        console.error(`   First person in batch:`, JSON.stringify(batch[0]));
                        throw insertErr;
                    }
                }

                // Reassign person IDs in Redis
                console.log(`💾 [6/8] Reassigning ${idMappings.length} IDs in Redis...`);
                if (idMappings.length > 0) {
                    await PopulationState.reassignIds(idMappings);
                }
            }

            // 4. Update families with correct husband/wife IDs (if they were temp IDs)
            if (familyIdMappings.length > 0 && idMappings.length > 0) {
                console.log(`🔗 Updating family member references...`);
                for (const familyMapping of familyIdMappings) {
                    const family = await PopulationState.getFamily(familyMapping.newId);
                    if (family) {
                        let updateNeeded = false;
                        let newHusbandId = family.husband_id;
                        let newWifeId = family.wife_id;

                        // Check if husband_id needs mapping
                        const husbandMapping = idMappings.find(m => m.tempId === family.husband_id);
                        if (husbandMapping) {
                            newHusbandId = husbandMapping.newId;
                            updateNeeded = true;
                        }

                        // Check if wife_id needs mapping
                        const wifeMapping = idMappings.find(m => m.tempId === family.wife_id);
                        if (wifeMapping) {
                            newWifeId = wifeMapping.newId;
                            updateNeeded = true;
                        }

                        if (updateNeeded) {
                            await pool.query(`
                            UPDATE family SET husband_id = $1, wife_id = $2, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $3
                        `, [newHusbandId, newWifeId, familyMapping.newId]);
                        }

                        // Also update children_ids if any are temp IDs
                        const childrenIds = family.children_ids || [];
                        const newChildrenIds = childrenIds.map(cid => {
                            const mapping = idMappings.find(m => m.tempId === cid);
                            return mapping ? mapping.newId : cid;
                        });
                        if (JSON.stringify(childrenIds) !== JSON.stringify(newChildrenIds)) {
                            await pool.query(`
                            UPDATE family SET children_ids = $1, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $2
                        `, [newChildrenIds, familyMapping.newId]);
                        }
                    }
                }
            }

            // 5. Update existing families that were modified (pregnancy status, etc.)
            console.log('💾 [7/8] Getting pending family updates...');
            const pendingFamilyUpdates = await PopulationState.getPendingFamilyUpdates();
            let familiesUpdated = 0;
            if (pendingFamilyUpdates.length > 0) {
                console.log(`📝 Updating ${pendingFamilyUpdates.length} families in PostgreSQL...`);
                // Filter out families with temp IDs (they were just inserted above)
                const existingFamilies = pendingFamilyUpdates.filter(f => f.id > 0);
                console.log(`   ${existingFamilies.length} families have positive IDs to update`);

                for (const f of existingFamilies) {
                    try {
                        await pool.query(`
                        UPDATE family SET 
                            pregnancy = $1, 
                            delivery_date = $2, 
                            children_ids = $3,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $4
                    `, [f.pregnancy, f.delivery_date, f.children_ids || [], f.id]);
                        familiesUpdated++;
                    } catch (err) {
                        console.error(`❌ Failed to update family ${f.id}:`, err.message);
                    }
                }
                console.log(`   Family updates complete: ${familiesUpdated}`);
            }

            // 6. Update existing people (health, family_id for positive IDs only)
            console.log('💾 [8/8] Updating existing people...');
            const personData = await redis.hgetall('person');
            const existingPeople = Object.values(personData)
                .map(json => JSON.parse(json))
                .filter(p => p.id > 0 && !p._isNew); // Only update existing Postgres records

            console.log(`   Found ${existingPeople.length} existing people to update`);
            let updatedCount = 0;
            if (existingPeople.length > 0) {
                try {
                    // Only update family_id for people with TEMP family IDs (negative) that need remapping
                    const peopleWithTempFamilyIds = existingPeople.filter(p => p.family_id && p.family_id < 0);
                    console.log(`   ${peopleWithTempFamilyIds.length} people have temp family_id to remap`);
                    if (peopleWithTempFamilyIds.length > 0) {
                        for (const p of peopleWithTempFamilyIds) {
                            // Map temp family_id to real one
                            const mapping = familyIdMappings.find(m => m.tempId === p.family_id);
                            if (mapping) {
                                await pool.query(`
                                UPDATE people SET family_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
                            `, [mapping.newId, p.id]);
                            }
                        }
                        console.log(`   Family_id remapping complete`);
                    }

                    // Skip health update for now - health values are all 100 and don't change yet
                    // When health actually changes, we'll need to track which people's health changed
                    // and only update those (similar to pending:inserts tracking)
                    updatedCount = 0;
                } catch (err) {
                    console.warn('⚠️ Could not update people:', err.message);
                }
            }

            // Clear pending operations after successful save
            await PopulationState.clearPendingOperations();
            await PopulationState.clearPendingFamilyOperations();

            const elapsed = Date.now() - startTime;
            console.log(`✅ Saved to PostgreSQL in ${elapsed}ms: ${villageCount} villages, ${insertedCount} people inserts, ${deletedCount} people deletes, ${updatedCount} people updates, ${familiesInserted} families inserted, ${familiesUpdated} families updated, ${familiesDeleted} families deleted`);

            if (this.io) {
                this.io.emit('gameSaved', {
                    timestamp: new Date().toISOString(),
                    villages: villageCount,
                    inserted: insertedCount,
                    deleted: deletedCount,
                    updated: updatedCount,
                    familiesInserted,
                    familiesUpdated,
                    familiesDeleted,
                    elapsed
                });
            }

            // After saving to DB, refresh population stats and emit to clients so UI reflects DB truth
            try {
                const { getAllPopulationData } = require('./population/PopStats');
                const populationData = await getAllPopulationData(pool, null, null);
                if (this.io) {
                    this.io.emit('populationUpdate', populationData);
                }
            } catch (err) {
                console.warn('⚠️ Could not emit populationUpdate after save:', err.message);
            }

            return {
                villages: villageCount,
                people: insertedCount,
                inserted: insertedCount,
                deleted: deletedCount,
                updated: updatedCount,
                familiesInserted,
                familiesUpdated,
                familiesDeleted,
                elapsed
            };
        } finally {
            // Resume calendar ticks after save completes (or fails)
            if (wasRunning && this.calendarService) {
                console.log('▶️ Resuming calendar after save...');
                this.calendarService.start();
            }
        }
    }

    /**
     * Get a village from Redis
     */
    static async getVillage(villageId) {
        const json = await redis.hget('village', villageId.toString());
        return json ? JSON.parse(json) : null;
    }

    /**
     * Update a village in Redis (no database write)
     */
    static async updateVillage(villageId, updates) {
        const village = await this.getVillage(villageId);
        if (!village) return null;

        const updated = { ...village, ...updates };
        await redis.hset('village', villageId.toString(), JSON.stringify(updated));
        return updated;
    }

    /**
     * Get all villages from Redis
     */
    static async getAllVillages() {
        const data = await redis.hgetall('village');
        return Object.values(data).map(json => JSON.parse(json));
    }

    /**
     * Get a person from Redis
     */
    static async getPerson(personId) {
        const json = await redis.hget('person', personId.toString());
        return json ? JSON.parse(json) : null;
    }

    /**
     * Update a person in Redis (no database write)
     */
    static async updatePerson(personId, updates) {
        const person = await this.getPerson(personId);
        if (!person) return null;

        const updated = { ...person, ...updates };
        await redis.hset('person', personId.toString(), JSON.stringify(updated));
        return updated;
    }

    /**
     * Get all people from Redis
     */
    static async getAllPeople() {
        const data = await redis.hgetall('person');
        return Object.values(data).map(json => JSON.parse(json));
    }

    /**
     * Get population count for a village (from Redis index)
     */
    static async getVillagePopulation(tileId, chunkIndex) {
        return await redis.scard(`village:${tileId}:${chunkIndex}:people`);
    }

    /**
     * Get fertility for a tile from Redis
     */
    static async getTileFertility(tileId) {
        const val = await redis.hget('tile:fertility', tileId.toString());
        return parseInt(val) || 0;
    }

    /**
     * Get cleared land count for a village from Redis
     */
    static async getVillageClearedLand(villageId) {
        const val = await redis.hget('village:cleared', villageId.toString());
        return parseInt(val) || 0;
    }

    /**
     * Add a single person record to Redis and index by village
     */
    static async addPersonToRedis(person) {
        if (!isRedisAvailable()) return false;
        try {
            const id = person.id.toString();
            await redis.hset('person', id, JSON.stringify(person));
            // Index in village set if residency and tile_id present
            if (person.tile_id && person.residency !== null && person.residency !== undefined) {
                await redis.sadd(`village:${person.tile_id}:${person.residency}:people`, id);
            }
            return true;
        } catch (err) {
            console.warn('⚠️ Failed to add person to Redis:', err.message);
            return false;
        }
    }

    /**
     * Remove a person from Redis and village index
     */
    static async removePersonFromRedis(personId) {
        if (!isRedisAvailable()) return false;
        try {
            const id = personId.toString();
            const json = await redis.hget('person', id);
            if (json) {
                const p = JSON.parse(json);
                if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                    await redis.srem(`village:${p.tile_id}:${p.residency}:people`, id);
                }
            }
            await redis.hdel('person', id);
            return true;
        } catch (err) {
            console.warn('⚠️ Failed to remove person from Redis:', err.message);
            return false;
        }
    }

    /**
     * Check if Redis state is initialized
     */
    static isInitialized() {
        return this.initialized;
    }

    /**
     * Clear all Redis state (useful for testing)
     */
    static async clearRedis() {
        const keys = await redis.keys('*');
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        this.initialized = false;
        console.log('🗑️ Redis state cleared');
    }
}

module.exports = StateManager;
