/**
 * State Manager - Save Operations
 * Handles saving storage state back to PostgreSQL
 */

const storage = require('../storage');
const pool = require('../../config/database');

/**
 * Save all Redis state back to PostgreSQL
 * This is a full save - it saves ALL data from Redis, replacing what's in Postgres.
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
        console.log('💾 Saving ALL game state from Redis to PostgreSQL...');
        const startTime = Date.now();
        const PopulationState = require('../populationState');
        
        // DEBUG: Check storage adapter info
        const adapter = storage.getAdapter ? storage.getAdapter() : null;
        const adapterName = adapter?.constructor?.name || adapter?.client?.constructor?.name || 'unknown';
        console.log(`💾 [DEBUG] Storage adapter: ${adapterName}, isAvailable: ${storage.isAvailable()}`);
        
        // DEBUG: Check if we can reach Redis at all
        try {
            const allKeys = await storage.keys('*');
            console.log(`💾 [DEBUG] All Redis keys at save time: ${allKeys.length} keys - ${allKeys.slice(0, 10).join(', ')}${allKeys.length > 10 ? '...' : ''}`);
        } catch (e) {
            console.log(`💾 [DEBUG] Could not list Redis keys: ${e.message}`);
        }

        // Read all data from Redis
        const allTileData = await storage.hgetall('tile') || {};
        const allLandsData = await storage.hgetall('tile:lands') || {};
        const allVillageData = await storage.hgetall('village') || {};
        
        console.log(`💾 [DEBUG] About to call hgetall('person')...`);
        const allPeopleData = await storage.hgetall('person') || {};
        console.log(`💾 [DEBUG] hgetall('person') returned: ${allPeopleData ? Object.keys(allPeopleData).length : 'null'} entries`);
        
        const allFamilyData = await storage.hgetall('family') || {};

        const tileCount = Object.keys(allTileData).length;
        const villageCount = Object.keys(allVillageData).length;
        const peopleCount = Object.keys(allPeopleData).length;
        const familyCount = Object.keys(allFamilyData).length;

        console.log(`💾 Redis data: ${tileCount} tiles, ${villageCount} villages, ${peopleCount} people, ${familyCount} families`);

        let tilesSaved = 0;
        let landsSaved = 0;
        let villagesInserted = 0;
        let insertedCount = 0;
        let familiesInserted = 0;

        // ========== STEP 1: Save tiles (with TRUNCATE CASCADE to clear dependent tables) ==========
        if (tileCount > 0) {
            console.log('💾 Step 1: Saving tiles to Postgres (TRUNCATE CASCADE will clear dependent tables)...');
            
            // Clear existing tiles and lands - CASCADE will also clear villages/people/families
            await pool.query('TRUNCATE TABLE tiles RESTART IDENTITY CASCADE');
            await pool.query('TRUNCATE TABLE tiles_lands RESTART IDENTITY CASCADE');

            // Prepare tile data for batch insert
            const tileValues = [];
            const tileParams = [];
            let paramIndex = 1;

            for (const [tileId, tileJson] of Object.entries(allTileData)) {
                const tile = JSON.parse(tileJson);
                tileValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12})`);
                tileParams.push(
                    tile.id,
                    tile.center_x,
                    tile.center_y,
                    tile.center_z,
                    tile.latitude,
                    tile.longitude,
                    tile.terrain_type,
                    tile.is_land,
                    tile.is_habitable,
                    tile.boundary_points,
                    tile.neighbor_ids,
                    tile.biome,
                    tile.fertility
                );
                paramIndex += 13;
            }

            // Batch insert tiles
            if (tileValues.length > 0) {
                await pool.query(`
                    INSERT INTO tiles (id, center_x, center_y, center_z, latitude, longitude, terrain_type, is_land, is_habitable, boundary_points, neighbor_ids, biome, fertility)
                    VALUES ${tileValues.join(', ')}
                `, tileParams);
                tilesSaved = tileValues.length;
            }

            // Prepare lands data for batch insert
            const landValues = [];
            const landParams = [];
            let landParamIndex = 1;
            const BATCH_SIZE = 5000;

            for (const [tileId, landsJson] of Object.entries(allLandsData)) {
                const lands = JSON.parse(landsJson);
                for (const land of lands) {
                    landValues.push(`($${landParamIndex}, $${landParamIndex + 1}, $${landParamIndex + 2}, $${landParamIndex + 3})`);
                    landParams.push(land.tile_id, land.chunk_index, land.land_type, land.cleared);
                    landParamIndex += 4;

                    // Insert in batches
                    if (landValues.length >= BATCH_SIZE) {
                        await pool.query(
                            `INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared) VALUES ${landValues.join(', ')}`,
                            landParams
                        );
                        landsSaved += landValues.length;
                        landValues.length = 0;
                        landParams.length = 0;
                        landParamIndex = 1;
                    }
                }
            }

            // Insert remaining lands
            if (landValues.length > 0) {
                await pool.query(
                    `INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared) VALUES ${landValues.join(', ')}`,
                    landParams
                );
                landsSaved += landValues.length;
            }

            // Clear the regeneration flag since we just saved tiles
            await storage.del('pending:tiles:regenerate');
            console.log(`💾 Step 1 complete: Saved ${tilesSaved} tiles and ${landsSaved} land chunks`);
        }

        // ========== STEP 2: Save ALL villages from Redis ==========
        if (villageCount > 0) {
            console.log(`💾 Step 2: Saving ${villageCount} villages to Postgres...`);
            for (const [id, json] of Object.entries(allVillageData)) {
                try {
                    const v = JSON.parse(json);
                    await pool.query(`
                        INSERT INTO villages (id, tile_id, land_chunk_index, name, housing_slots, housing_capacity, food_stores, food_capacity, food_production_rate)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        ON CONFLICT (id) DO UPDATE SET
                            food_stores = EXCLUDED.food_stores,
                            food_production_rate = EXCLUDED.food_production_rate,
                            updated_at = CURRENT_TIMESTAMP
                    `, [v.id, v.tile_id, v.land_chunk_index, v.name || 'Village', JSON.stringify(v.housing_slots || []), v.housing_capacity || 1000, v.food_stores || 0, v.food_capacity || 100000, v.food_production_rate || 50]);
                    villagesInserted++;
                } catch (e) {
                    console.warn(`Failed to save village ${id}:`, e.message);
                }
            }
            // Update tiles_lands village references
            for (const [id, json] of Object.entries(allVillageData)) {
                try {
                    const v = JSON.parse(json);
                    await pool.query(`UPDATE tiles_lands SET village_id = $1 WHERE tile_id = $2 AND chunk_index = $3`, [v.id, v.tile_id, v.land_chunk_index]);
                } catch (_) { /* non-fatal */ }
            }
            console.log(`💾 Step 2 complete: Saved ${villagesInserted} villages`);
        }

        // ========== STEP 3: Save ALL people from Redis ==========
        if (peopleCount > 0) {
            console.log(`💾 Step 3: Saving ${peopleCount} people to Postgres...`);
            const peopleBatchSize = 500;
            const peopleEntries = Object.entries(allPeopleData);

            for (let i = 0; i < peopleEntries.length; i += peopleBatchSize) {
                const batch = peopleEntries.slice(i, i + peopleBatchSize);
                const values = [];
                const params = [];
                let paramIdx = 1;

                for (const [id, json] of batch) {
                    try {
                        const p = JSON.parse(json);
                        values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})`);
                        params.push(p.id, p.tile_id, p.sex, p.date_of_birth, p.residency, p.family_id || null);
                        paramIdx += 6;
                    } catch (e) { /* skip invalid */ }
                }

                if (values.length > 0) {
                    try {
                        await pool.query(`
                            INSERT INTO people (id, tile_id, sex, date_of_birth, residency, family_id)
                            VALUES ${values.join(',')}
                            ON CONFLICT (id) DO UPDATE SET
                                tile_id = EXCLUDED.tile_id,
                                residency = EXCLUDED.residency,
                                family_id = EXCLUDED.family_id,
                                updated_at = CURRENT_TIMESTAMP
                        `, params);
                        insertedCount += values.length;
                    } catch (e) {
                        console.warn('Batch insert failed:', e.message);
                    }
                }
            }
            console.log(`💾 Step 3 complete: Saved ${insertedCount} people`);
        }

        // ========== STEP 4: Save ALL families from Redis ==========
        if (familyCount > 0) {
            console.log(`💾 Step 4: Saving ${familyCount} families to Postgres...`);
            for (const [id, json] of Object.entries(allFamilyData)) {
                try {
                    const f = JSON.parse(json);
                    await pool.query(`
                        INSERT INTO family (id, husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (id) DO UPDATE SET
                            pregnancy = EXCLUDED.pregnancy,
                            delivery_date = EXCLUDED.delivery_date,
                            children_ids = EXCLUDED.children_ids,
                            updated_at = CURRENT_TIMESTAMP
                    `, [f.id, f.husband_id || null, f.wife_id || null, f.tile_id, f.pregnancy || false, f.delivery_date || null, f.children_ids || []]);
                    familiesInserted++;
                } catch (e) {
                    console.warn(`Failed to save family ${id}:`, e.message);
                }
            }
            console.log(`💾 Step 4 complete: Saved ${familiesInserted} families`);
        }

        // Clear all pending operation sets since we just saved everything
        await PopulationState.clearPendingOperations();
        await PopulationState.clearPendingFamilyOperations();
        try { await storage.del('pending:village:inserts'); } catch (_) {}

        const elapsed = Date.now() - startTime;
        console.log(`✅ Save complete in ${elapsed}ms: ${tilesSaved} tiles, ${villagesInserted} villages, ${insertedCount} people, ${familiesInserted} families`);

        // Emit save event
        if (context.io) {
            context.io.emit('gameSaved', {
                timestamp: new Date().toISOString(),
                tiles: tilesSaved,
                villages: villagesInserted,
                people: insertedCount,
                families: familiesInserted
            });
        }

        // Refresh population stats
        await emitPopulationUpdate(context.io);

        // Save calendar state to database
        if (context.calendarService && typeof context.calendarService.saveStateToDB === 'function') {
            try {
                await context.calendarService.saveStateToDB();
                console.log('📅 Calendar state saved to database');
            } catch (err) {
                console.warn('⚠️ Failed to save calendar state:', err.message);
            }
        }

        return {
            tiles: tilesSaved,
            lands: landsSaved,
            villages: villagesInserted,
            people: insertedCount,
            families: familiesInserted,
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
    emitPopulationUpdate
};
