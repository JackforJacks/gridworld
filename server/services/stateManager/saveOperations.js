/**
 * State Manager - Save Operations
 * Handles saving Redis state back to PostgreSQL
 */

const redis = require('../../config/redis');
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
        console.log('💾 [1/8] Saving Redis state to PostgreSQL...');
        const startTime = Date.now();
        const PopulationState = require('../populationState');

        // Get village data
        console.log('💾 [2/8] Getting village data...');
        const villageData = await redis.hgetall('village');
        const villageCount = Object.keys(villageData).length;
        console.log(`💾 [2/8] Got ${villageCount} villages`);

        // Handle pending village inserts
        const { villagesInserted, villageIdMappings } = await insertPendingVillages(villageData, PopulationState);

        // Update existing villages
        if (villageCount > 0) {
            await updateExistingVillages(villageData);
        }

        // Process pending family deletes
        const familiesDeleted = await processFamilyDeletes(PopulationState);

        // Process pending people deletes
        const deletedCount = await processPeopleDeletes(PopulationState);

        // Process pending family inserts
        const { familiesInserted, familyIdMappings } = await insertPendingFamilies(PopulationState);

        // Process pending people inserts
        const { insertedCount, idMappings } = await insertPendingPeople(PopulationState, familyIdMappings);

        // Update family member references
        await updateFamilyReferences(familyIdMappings, idMappings, PopulationState);

        // Update existing families
        const familiesUpdated = await updateExistingFamilies(PopulationState, familyIdMappings);

        // Update existing people
        const updatedCount = await updateExistingPeople(familyIdMappings);

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
            console.log(`🏗️ Reassigned ${villageIdMappings.length} village IDs in Redis`);
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
                await redis.srem('eligible:pregnancy:families', fid.toString());
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

        console.log(`💾 [6/8] Reassigning ${idMappings.length} IDs in Redis...`);
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
    const personData = await redis.hgetall('person');
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
    insertPendingFamilies,
    insertPendingPeople,
    updateFamilyReferences,
    updateExistingFamilies,
    updateExistingPeople,
    emitPopulationUpdate
};
