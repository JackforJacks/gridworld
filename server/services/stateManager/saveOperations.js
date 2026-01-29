/**
 * State Manager - Save Operations
 * Handles saving storage state back to PostgreSQL
 */

const storage = require('../storage');
const pool = require('../../config/database');

/**
 * Save all Redis state back to PostgreSQL
 * @param {Object} context - StateManager context with calendarService, io
 * @returns {Promise<Object>} Save results
 */
async function saveToDatabase(context) {
    console.log(`💾 Calendar service available: ${!!context.calendarService}, isRunning: ${context.calendarService?.state?.isRunning}`);
    const wasRunning = context.calendarService?.state?.isRunning;

    // Pause calendar ticks during save
    if (wasRunning && context.calendarService) {
        console.log('⏸️ Pausing calendar for save...');
        context.calendarService.stop();
    }

    try {
        console.log('💾 [1/8] Saving storage state to PostgreSQL...');
        const startTime = Date.now();
        const PopulationState = require('../populationState');
        // Early exit: if there are no pending operations to save, skip the heavy save routine.
        try {
            const [pendingInserts, pendingUpdates, pendingDeletes, pendingFamilyInserts, pendingFamilyUpdates, pendingFamilyDeletes, pendingVillageInserts] = await Promise.all([
                PopulationState.getPendingInserts(),
                PopulationState.getPendingUpdates(),
                PopulationState.getPendingDeletes(),
                PopulationState.getPendingFamilyInserts ? PopulationState.getPendingFamilyInserts() : Promise.resolve([]),
                PopulationState.getPendingFamilyUpdates ? PopulationState.getPendingFamilyUpdates() : Promise.resolve([]),
                PopulationState.getPendingFamilyDeletes ? PopulationState.getPendingFamilyDeletes() : Promise.resolve([]),
                PopulationState.getPendingVillageInserts ? PopulationState.getPendingVillageInserts() : Promise.resolve([])
            ]);

            // For village pending inserts, ensure there's actually village JSON present in the 'village' hash
            let villageEntriesCount = 0;
            if (pendingVillageInserts && pendingVillageInserts.length > 0) {
                try {
                    const pipeline = storage.pipeline();
                    for (const id of pendingVillageInserts) pipeline.hget('village', id.toString());
                    const results = await pipeline.exec();
                    for (const [err, json] of results) {
                        if (!err && json) villageEntriesCount++;
                    }
                } catch (e) {
                    console.warn('⚠️ Could not inspect pending village entries:', e && e.message ? e.message : e);
                    // Fallback to counting IDs (conservative approach) if inspection fails
                    villageEntriesCount = pendingVillageInserts.length;
                }
            }

            const totalPending = (pendingInserts?.length || 0) + (pendingUpdates?.length || 0) + (pendingDeletes?.length || 0) + (pendingFamilyInserts?.length || 0) + (pendingFamilyUpdates?.length || 0) + (pendingFamilyDeletes?.length || 0) + (villageEntriesCount || 0);

            if (totalPending === 0) {
                console.log('💤 No meaningful pending operations found, proceeding with save to provide consistent return structure.');
                // Intentionally continue with save flow so we return a consistent object (0 counts) for callers/tests
            }
        } catch (err) {
            console.warn('⚠️ Could not determine pending operations, proceeding with save:', err && err.message ? err.message : err);
        }
        // Get village data
        console.log('💾 [2/8] Getting village data...');
        const villageData = await storage.hgetall('village');
        const villageCount = villageData ? Object.keys(villageData).length : 0;
        console.log(`💾 [2/8] Got ${villageCount} villages`);

        // Handle pending village inserts
        const { insertPendingVillages } = require('./parts/villages');
        const { processFamilyDeletes } = require('./parts/families');
        const { processPeopleDeletes } = require('./parts/people');

        const { villagesInserted, villageIdMappings } = await insertPendingVillages(villageData, PopulationState);

        // Update existing villages
        if (villageCount > 0) {
            await updateExistingVillages(villageData);
        }

        // Process pending family deletes
        const familiesDeleted = await processFamilyDeletes(PopulationState);

        // Process pending people deletes
        const deletedCount = await processPeopleDeletes(PopulationState);

        // Insert pending people first (ensure referenced people exist before family FKs are inserted)
        const insertedCount = await insertPendingPeopleDirect(PopulationState);

        // Insert pending families (IDs are real Postgres IDs from idAllocator)
        const familiesInserted = await insertPendingFamiliesDirect(PopulationState);

        // Update existing families
        const familiesUpdated = await updateExistingFamilies(PopulationState, []);

        // Update existing people
        const updatedCount = await updateExistingPeople([]);

        // Clear pending operations
        await PopulationState.clearPendingOperations();
        await PopulationState.clearPendingFamilyOperations();

        const elapsed = Date.now() - startTime;
        console.log(`✅ Saved to PostgreSQL in ${elapsed}ms: ${villageCount} villages, ${insertedCount} people inserts, ${deletedCount} people deletes, ${updatedCount} people updates, ${familiesInserted} families inserted, ${familiesUpdated} families updated, ${familiesDeleted} families deleted`);

        // Emit save event
        if (context.io) {
            context.io.emit('gameSaved', {
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

        // Refresh population stats
        await emitPopulationUpdate(context.io);

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
        // Resume calendar ticks after save
        if (wasRunning && context.calendarService) {
            console.log('▶️ Resuming calendar after save...');
            context.calendarService.start();
        }
    }
}

/**
 * Insert pending villages into PostgreSQL
 */
async function insertPendingVillages(villageData, PopulationState) {
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
            console.log(`🏗️ Reassigned ${villageIdMappings.length} village IDs in storage`);
        }
        console.log(`🏗️ Inserted ${villagesInserted} villages into Postgres`);
    }

    return { villagesInserted, villageIdMappings };
}

/**
 * Update existing villages in PostgreSQL
 */
async function updateExistingVillages(villageData) {
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

/**
 * Process pending family deletes
 */
async function processFamilyDeletes(PopulationState) {
    console.log('💾 [3/8] Getting pending family deletes...');
    const pendingFamilyDeletes = await PopulationState.getPendingFamilyDeletes();
    console.log(`💾 [3/8] Found ${pendingFamilyDeletes.length} family deletes`);

    if (pendingFamilyDeletes.length > 0) {
        console.log(`🗑️ Deleting ${pendingFamilyDeletes.length} families from PostgreSQL...`);

        // Remove from fertile family set
        try {
            for (const fid of pendingFamilyDeletes) {
                await storage.srem('eligible:pregnancy:families', fid.toString());
            }
        } catch (_) { }

        // Clear family_id references in people table
        const famPlaceholders = pendingFamilyDeletes.map((_, idx) => `$${idx + 1}`).join(',');
        await pool.query(`UPDATE people SET family_id = NULL WHERE family_id IN (${famPlaceholders})`, pendingFamilyDeletes);

        // Delete the families
        await pool.query(`DELETE FROM family WHERE id IN (${famPlaceholders})`, pendingFamilyDeletes);
    }

    return pendingFamilyDeletes.length;
}

/**
 * Process pending people deletes
 */
async function processPeopleDeletes(PopulationState) {
    const pendingDeletes = await PopulationState.getPendingDeletes();

    if (pendingDeletes.length > 0) {
        console.log(`🗑️ Deleting ${pendingDeletes.length} people from PostgreSQL...`);
        const placeholders = pendingDeletes.map((_, idx) => `$${idx + 1}`).join(',');
        await pool.query(`DELETE FROM people WHERE id IN (${placeholders})`, pendingDeletes);
    }

    return pendingDeletes.length;
}

/**
 * Insert pending families directly with their real Postgres IDs
 * IDs are pre-allocated from Postgres sequences via idAllocator, so no remapping needed
 */
async function insertPendingFamiliesDirect(PopulationState) {
    console.log('💾 [5/8] Inserting pending families...');
    const pendingFamilyInserts = await PopulationState.getPendingFamilyInserts();
    console.log(`💾 [5/8] Found ${pendingFamilyInserts.length} family inserts`);

    let familiesInserted = 0;

    if (pendingFamilyInserts.length > 0) {
        console.log(`👨‍👩‍👧 Inserting ${pendingFamilyInserts.length} families with real IDs...`);

        // Batch insert families with explicit IDs
        const batchSize = 100;
        for (let i = 0; i < pendingFamilyInserts.length; i += batchSize) {
            const batch = pendingFamilyInserts.slice(i, i + batchSize);

            const values = [];
            const params = [];
            let paramIdx = 1;

            for (const f of batch) {
                // Validate referenced husband and wife exist in Postgres. If not found, set to NULL to avoid FK failures.
                let husbandId = f.husband_id > 0 ? f.husband_id : null;
                let wifeId = f.wife_id > 0 ? f.wife_id : null;

                if (husbandId) {
                    try {
                        const h = await pool.query('SELECT 1 FROM people WHERE id = $1', [husbandId]);
                        if (h.rowCount === 0) {
                            console.warn(`[insertPendingFamiliesDirect] Husband ${husbandId} not found in Postgres, setting to NULL for family ${f.id}`);
                            husbandId = null;
                        }
                    } catch (e) {
                        // If check fails, proceed with original ID (optimistic), but log a warning
                        console.warn('[insertPendingFamiliesDirect] Could not verify husband existence:', e && e.message ? e.message : e);
                    }
                }
                if (wifeId) {
                    try {
                        const w = await pool.query('SELECT 1 FROM people WHERE id = $1', [wifeId]);
                        if (w.rowCount === 0) {
                            console.warn(`[insertPendingFamiliesDirect] Wife ${wifeId} not found in Postgres, setting to NULL for family ${f.id}`);
                            wifeId = null;
                        }
                    } catch (e) {
                        console.warn('[insertPendingFamiliesDirect] Could not verify wife existence:', e && e.message ? e.message : e);
                    }
                }

                values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6})`);
                params.push(
                    f.id,
                    husbandId,
                    wifeId,
                    f.tile_id,
                    f.pregnancy || false,
                    f.delivery_date || null,
                    f.children_ids || []
                );
                paramIdx += 7;
            }

            try {
                await pool.query(`
                    INSERT INTO family (id, husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                    VALUES ${values.join(',')}
                    ON CONFLICT (id) DO UPDATE SET
                        husband_id = EXCLUDED.husband_id,
                        wife_id = EXCLUDED.wife_id,
                        tile_id = EXCLUDED.tile_id,
                        pregnancy = EXCLUDED.pregnancy,
                        delivery_date = EXCLUDED.delivery_date,
                        children_ids = EXCLUDED.children_ids,
                        updated_at = CURRENT_TIMESTAMP
                `, params);
                familiesInserted += batch.length;
            } catch (err) {
                console.error(`❌ Family batch insert failed:`, err.message);
                console.error(`   First family in batch:`, JSON.stringify(batch[0]));
                throw err;
            }
        }

        // Clear _isNew flags in Redis
        for (const f of pendingFamilyInserts) {
            await PopulationState.updateFamily(f.id, { _isNew: false });
        }

        console.log(`💾 [5/8] Inserted ${familiesInserted} families`);
    }

    return familiesInserted;
}

/**
 * Insert pending people directly with their real Postgres IDs
 * IDs are pre-allocated from Postgres sequences via idAllocator, so no remapping needed
 */
async function insertPendingPeopleDirect(PopulationState) {
    console.log('💾 [6/8] Inserting pending people...');
    const pendingInserts = await PopulationState.getPendingInserts();

    let insertedCount = 0;

    if (pendingInserts.length > 0) {
        console.log(`📥 Inserting ${pendingInserts.length} people with real IDs...`);
        const batchSize = 100;

        for (let i = 0; i < pendingInserts.length; i += batchSize) {
            const batch = pendingInserts.slice(i, i + batchSize);
            console.log(`   Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pendingInserts.length / batchSize)}: ${batch.length} people`);

            // Gather referenced family IDs for this batch
            const familyIds = Array.from(new Set(batch.map(p => (p.family_id && Number.isInteger(p.family_id) && p.family_id > 0) ? p.family_id : null).filter(Boolean)));
            let missingFamilyIds = [];

            if (familyIds.length > 0) {
                try {
                    const res = await pool.query('SELECT id FROM family WHERE id = ANY($1::int[])', [familyIds]);
                    const existing = new Set(res.rows.map(r => r.id));
                    missingFamilyIds = familyIds.filter(id => !existing.has(id));
                } catch (e) {
                    console.warn('[insertPendingPeopleDirect] Could not verify family existence:', e && e.message ? e.message : e);
                    // If we cannot verify, proceed and let insert handle FK errors
                    missingFamilyIds = [];
                }
            }

            // If families are missing but present as pending in Redis, insert those families first
            if (missingFamilyIds.length > 0) {
                try {
                    const pendingFamilies = await PopulationState.getPendingInserts();
                    const pendingFamilyIds = pendingFamilies.map(f => f.id);
                    const familiesToInsert = missingFamilyIds.filter(id => pendingFamilyIds.includes(id));
                    if (familiesToInsert.length > 0) {
                        console.log(`[insertPendingPeopleDirect] Found ${familiesToInsert.length} missing families that are pending in Redis; inserting families first.`);
                        await insertPendingFamiliesDirect(PopulationState);
                        // Re-check which are still missing
                        const res2 = await pool.query('SELECT id FROM family WHERE id = ANY($1::int[])', [missingFamilyIds]);
                        const existing2 = new Set(res2.rows.map(r => r.id));
                        missingFamilyIds = missingFamilyIds.filter(id => !existing2.has(id));
                    }
                } catch (e) {
                    console.warn('[insertPendingPeopleDirect] Error while inserting dependent families:', e && e.message ? e.message : e);
                }
            }

            // Build values & params, nulling any still-missing family refs
            const values = [];
            const params = [];
            let paramIdx = 1;

            for (const p of batch) {
                let familyId = (p.family_id && Number.isInteger(p.family_id) && p.family_id > 0) ? p.family_id : null;
                if (familyId && missingFamilyIds.includes(familyId)) {
                    console.warn(`[insertPendingPeopleDirect] Family ${familyId} still missing; setting family_id to NULL for person ${p.id}`);
                    familyId = null;
                }
                values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})`);
                params.push(p.id, p.tile_id, p.sex, p.date_of_birth, p.residency, familyId);
                paramIdx += 6;
            }

            // Attempt insertion; if a family FK violation still occurs, try to insert pending families and retry once
            let attempt = 0;
            while (attempt < 2) {
                try {
                    await pool.query(`
                        INSERT INTO people (id, tile_id, sex, date_of_birth, residency, family_id)
                        VALUES ${values.join(',')}
                        ON CONFLICT (id) DO UPDATE SET
                            tile_id = EXCLUDED.tile_id,
                            sex = EXCLUDED.sex,
                            date_of_birth = EXCLUDED.date_of_birth,
                            residency = EXCLUDED.residency,
                            family_id = EXCLUDED.family_id,
                            updated_at = CURRENT_TIMESTAMP
                    `, params);
                    insertedCount += batch.length;
                    console.log(`   Batch insert complete: ${insertedCount}/${pendingInserts.length}`);
                    break;
                } catch (insertErr) {
                    const msg = insertErr && insertErr.message ? insertErr.message : '';
                    console.error(`❌ Batch insert failed:`, msg);
                    console.error(`   First person in batch:`, JSON.stringify(batch[0]));

                    if (attempt === 0 && /people_family_id_fkey/i.test(msg)) {
                        console.log('[insertPendingPeopleDirect] Detected people_family_id_fkey violation; attempting to insert pending families and retry.');
                        try {
                            await insertPendingFamiliesDirect(PopulationState);
                        } catch (e) {
                            console.warn('[insertPendingPeopleDirect] Failed to insert pending families on retry:', e && e.message ? e.message : e);
                        }
                        attempt++;
                        continue;
                    }
                    // On any other or second failure, rethrow to bubble up
                    throw insertErr;
                }
            }
        }

        // Clear _isNew flags in Redis
        for (const p of pendingInserts) {
            await PopulationState.updatePerson(p.id, { _isNew: false });
        }

        console.log(`💾 [6/8] Inserted ${insertedCount} people`);
    }

    return insertedCount;
}

/**
 * Reserve pending families in PostgreSQL as placeholders (husband/wife set to NULL)
 * @deprecated Use insertPendingFamiliesDirect instead - IDs are now pre-allocated
 */
async function insertPendingFamiliesReserve(PopulationState) {
    console.log('💾 [5/8] Reserving pending family inserts in PostgreSQL (placeholders)...');
    const pendingFamilyInserts = await PopulationState.getPendingFamilyInserts();
    console.log(`💾 [5/8] Found ${pendingFamilyInserts.length} family inserts`);

    let familiesInserted = 0;
    const familyIdMappings = [];

    if (pendingFamilyInserts.length > 0) {
        console.log(`👨‍👩‍👧 Reserving ${pendingFamilyInserts.length} new families in PostgreSQL...`);

        for (const f of pendingFamilyInserts) {
            try {
                // Insert placeholder with NULL spouse references and empty children
                const insertResult = await pool.query(`
                    INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id
                `, [null, null, f.tile_id, f.pregnancy, f.delivery_date, []]);

                const newFamilyId = insertResult.rows[0].id;
                familyIdMappings.push({ tempId: f.id, newId: newFamilyId });
                familiesInserted++;
            } catch (err) {
                console.warn('[stateManager] Failed to reserve pending family:', err.message || err);
            }
        }

        console.log('💾 [5/8] Reassigning family IDs in storage...');
        if (familyIdMappings.length > 0) {
            await PopulationState.reassignFamilyIds(familyIdMappings);
        }
        console.log('💾 [5/8] Family IDs reassigned (reserved)');
    }

    return { familiesInserted, familyIdMappings };
}

/**
 * Insert pending families into PostgreSQL
 */
async function insertPendingFamilies(PopulationState) {
    console.log('💾 [5/8] Getting pending family inserts...');
    const pendingFamilyInserts = await PopulationState.getPendingFamilyInserts();
    console.log(`💾 [5/8] Found ${pendingFamilyInserts.length} family inserts`);

    let familiesInserted = 0;
    const familyIdMappings = [];

    if (pendingFamilyInserts.length > 0) {
        console.log(`👨‍👩‍👧 Inserting ${pendingFamilyInserts.length} new families into PostgreSQL...`);

        for (const f of pendingFamilyInserts) {
            let husbandId = f.husband_id > 0 ? f.husband_id : null;
            let wifeId = f.wife_id > 0 ? f.wife_id : null;

            // Validate that referenced people exist in PostgreSQL
            if (husbandId) {
                const husbandExists = await pool.query('SELECT 1 FROM people WHERE id = $1', [husbandId]);
                if (husbandExists.rows.length === 0) {
                    console.warn(`[insertPendingFamilies] Husband ${husbandId} not found in PostgreSQL, setting to null`);
                    husbandId = null;
                }
            }
            if (wifeId) {
                const wifeExists = await pool.query('SELECT 1 FROM people WHERE id = $1', [wifeId]);
                if (wifeExists.rows.length === 0) {
                    console.warn(`[insertPendingFamilies] Wife ${wifeId} not found in PostgreSQL, setting to null`);
                    wifeId = null;
                }
            }

            const insertResult = await pool.query(`
                INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `, [husbandId, wifeId, f.tile_id, f.pregnancy, f.delivery_date, f.children_ids || []]);

            const newFamilyId = insertResult.rows[0].id;
            familyIdMappings.push({ tempId: f.id, newId: newFamilyId });
            familiesInserted++;
        }

        console.log('💾 [5/8] Reassigning family IDs in storage...');
        if (familyIdMappings.length > 0) {
            await PopulationState.reassignFamilyIds(familyIdMappings);
        }
        console.log('💾 [5/8] Family IDs reassigned');
    }

    return { familiesInserted, familyIdMappings };
}

/**
 * Insert pending people into PostgreSQL
 */
async function insertPendingPeople(PopulationState, familyIdMappings) {
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
                let realFamilyId = p.family_id;
                if (p.family_id && p.family_id < 0) {
                    const mapping = familyIdMappings.find(m => m.tempId === p.family_id);
                    if (mapping) realFamilyId = mapping.newId;
                    else realFamilyId = null;
                }

                values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`);
                params.push(p.tile_id, p.sex, p.date_of_birth, p.residency, realFamilyId);
                paramIdx += 5;
            }

            try {
                const insertResult = await pool.query(`
                    INSERT INTO people (tile_id, sex, date_of_birth, residency, family_id)
                    VALUES ${values.join(',')}
                    RETURNING id
                `, params);

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

        console.log(`💾 [6/8] Reassigning ${idMappings.length} IDs in storage...`);
        if (idMappings.length > 0) {
            await PopulationState.reassignIds(idMappings);
        }
    }

    return { insertedCount, idMappings };
}

/**
 * Update family member references after ID remapping
 */
async function updateFamilyReferences(familyIdMappings, idMappings, PopulationState) {
    if (familyIdMappings.length > 0 && idMappings.length > 0) {
        console.log(`🔗 Updating family member references...`);
        for (const familyMapping of familyIdMappings) {
            const family = await PopulationState.getFamily(familyMapping.newId);
            if (family) {
                let updateNeeded = false;
                let newHusbandId = family.husband_id;
                let newWifeId = family.wife_id;

                const husbandMapping = idMappings.find(m => m.tempId === family.husband_id);
                if (husbandMapping) {
                    newHusbandId = husbandMapping.newId;
                    updateNeeded = true;
                }

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
}

/**
 * Update existing families with changes
 */
async function updateExistingFamilies(PopulationState, familyIdMappings) {
    console.log('💾 [7/8] Getting pending family updates...');
    const pendingFamilyUpdates = await PopulationState.getPendingFamilyUpdates();
    let familiesUpdated = 0;

    if (pendingFamilyUpdates.length > 0) {
        console.log(`📝 Updating ${pendingFamilyUpdates.length} families in PostgreSQL...`);
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

    return familiesUpdated;
}

/**
 * Update existing people in PostgreSQL
 */
async function updateExistingPeople(familyIdMappings) {
    console.log('💾 [8/8] Updating existing people...');
    const personData = await storage.hgetall('person');
    const existingPeople = Object.values(personData)
        .map(json => JSON.parse(json))
        .filter(p => p.id > 0 && !p._isNew);

    console.log(`   Found ${existingPeople.length} existing people to update`);

    if (existingPeople.length > 0) {
        try {
            const peopleWithTempFamilyIds = existingPeople.filter(p => p.family_id && p.family_id < 0);
            console.log(`   ${peopleWithTempFamilyIds.length} people have temp family_id to remap`);

            if (peopleWithTempFamilyIds.length > 0) {
                for (const p of peopleWithTempFamilyIds) {
                    const mapping = familyIdMappings.find(m => m.tempId === p.family_id);
                    if (mapping) {
                        await pool.query(`
                            UPDATE people SET family_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
                        `, [mapping.newId, p.id]);
                    }
                }
                console.log(`   Family_id remapping complete`);
            }
        } catch (err) {
            console.warn('⚠️ Could not update people:', err.message);
        }
    }

    return 0; // Health updates not implemented yet
}

/**
 * Emit population update after save
 */
async function emitPopulationUpdate(io) {
    try {
        const { getAllPopulationData } = require('../population/PopStats');
        const populationData = await getAllPopulationData(pool, null, null);
        if (io) {
            io.emit('populationUpdate', populationData);
        }
    } catch (err) {
        console.warn('⚠️ Could not emit populationUpdate after save:', err.message);
    }
}

module.exports = {
    saveToDatabase,
    insertPendingVillages,
    updateExistingVillages,
    processFamilyDeletes,
    processPeopleDeletes,
    insertPendingFamiliesDirect,
    insertPendingPeopleDirect,
    // Legacy functions (deprecated, kept for backward compatibility)
    insertPendingFamilies,
    insertPendingFamiliesReserve,
    insertPendingPeople,
    updateFamilyReferences,
    updateExistingFamilies,
    updateExistingPeople,
    emitPopulationUpdate
};
