/**
 * State Manager - Save Operations
 * Handles saving storage state back to PostgreSQL
 */

import storage from '../storage';
import pool from '../../config/database';
import { PoolClient } from 'pg';
import { Server as SocketIOServer } from 'socket.io';

// ========== Type Definitions ==========

interface CalendarService {
    state?: { isRunning?: boolean };
    start: () => void;
    stop: () => void;
    saveStateToDB?: () => Promise<void>;
}

interface SaveContext {
    calendarService?: CalendarService;
    io?: SocketIOServer;
}

interface SaveResult {
    tiles: number;
    lands: number;
    villages: number;
    people: number;
    families: number;
    elapsed: number;
    familyLinks: number;
}

interface PersonFamilyLink {
    personId: number;
    familyId: number;
}

interface VillageHasResidentsMap {
    [villageId: string]: boolean;
}

interface FilteredVillageData {
    [villageId: string]: string;
}

interface ParsedPerson {
    id: number;
    tile_id: number | null;
    residency: number | null;
    village_id?: number | null;
    sex: boolean | string;
    date_of_birth: string;
    family_id: number | null;
}

/**
 * Pre-parse all people data once for efficiency
 * Returns parsed people map and villageHasResidents map in a single pass
 */
function preParsePeopleData(
    allPeopleData: Record<string, string>,
    logError: (err: unknown, context: string, severity: unknown) => void,
    ErrorSeverity: { LOW: unknown }
): { parsedPeople: Map<string, ParsedPerson>; villageHasResidents: VillageHasResidentsMap } {
    const parsedPeople = new Map<string, ParsedPerson>();
    const villageHasResidents: VillageHasResidentsMap = {};
    
    for (const [personId, personJson] of Object.entries(allPeopleData)) {
        try {
            const person = JSON.parse(personJson as string);
            parsedPeople.set(personId, person);
            // Build villageHasResidents in the same pass
            const villageRef = person.village_id || person.residency;
            if (villageRef) {
                villageHasResidents[villageRef] = true;
            }
        } catch (err: unknown) {
            logError(err, `SaveOperations:ParsePerson:${personId}`, ErrorSeverity.LOW);
        }
    }
    
    return { parsedPeople, villageHasResidents };
}

/**
 * Save Rust simulation state to PostgreSQL
 * This exports the entire Rust ECS world to JSON and stores it
 */
async function saveRustSimulationState(): Promise<void> {
    const rustSimulation = require('../rustSimulation').default;
    
    const stateJson = rustSimulation.exportWorld();
    const demographics = rustSimulation.getDemographics();
    const calendar = rustSimulation.getCalendar();
    
    await pool.query(`
        INSERT INTO rust_simulation_state (id, state_json, population, calendar_year, last_updated)
        VALUES (1, $1, $2, $3, NOW())
        ON CONFLICT (id) DO UPDATE SET
            state_json = EXCLUDED.state_json,
            population = EXCLUDED.population,
            calendar_year = EXCLUDED.calendar_year,
            last_updated = NOW()
    `, [stateJson, demographics.population, calendar.year]);
    
    console.log(`🦀 [PostgreSQL] Saved Rust simulation state: ${demographics.population} people, year ${calendar.year}`);
}

/**
 * Save all Redis state back to PostgreSQL
 * This is a full save - it saves ALL data from Redis, replacing what's in Postgres.
 * @param context - StateManager context with calendarService, io
 * @returns Save results
 */
async function saveToDatabase(context: SaveContext): Promise<SaveResult> {
    const wasRunning = context.calendarService?.state?.isRunning;

    // Pause calendar ticks during save
    if (wasRunning && context.calendarService) {
        context.calendarService.stop();
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const startTime = Date.now();
        const PopulationState = require('../populationState').default;

        // Read all data from Redis
        const allTileData = await storage.hgetall('tile') || {};
        const allLandsData = await storage.hgetall('tile:lands') || {};
        const allVillageData = await storage.hgetall('village') || {};
        let allPeopleData = await storage.hgetall('person') || {};
        let allFamilyData = await storage.hgetall('family') || {};

        // --- STEP: Pre-parse people once and build villageHasResidents in single pass ---
        const { logError, ErrorSeverity } = require('../../utils/errorHandler');
        let { parsedPeople, villageHasResidents } = preParsePeopleData(allPeopleData, logError, ErrorSeverity);
        
        // Filter out villages with no residents
        const filteredVillageData: FilteredVillageData = {};
        for (const [villageId, villageJson] of Object.entries(allVillageData)) {
            if (villageHasResidents[villageId]) {
                filteredVillageData[villageId] = villageJson as string;
            }
        }

        const tileCount = Object.keys(allTileData).length;
        let villageCount = Object.keys(filteredVillageData).length;
        let peopleCount = parsedPeople.size;
        let familyCount = Object.keys(allFamilyData).length;

        // --- STEP: Pre-save validation for villages ---
        // NOTE: Validation and repair happen BEFORE transaction to avoid Redis-DB inconsistency
        // If repair fails, we abort before modifying the database
        const villageManager = await import('../villageSeeder/villageManager');
        const validation = await villageManager.validateVillageConsistency();
        if (!validation.valid) {
            console.warn(`[SaveOperations] Village consistency issues detected before save: ${validation.issues.length} issues`);
            for (const issue of validation.issues.slice(0, 5)) {
                console.warn(`[SaveOperations]   - ${issue.type}: tile ${issue.tileId}`);
            }

            // Auto-repair missing villages or other inconsistencies
            console.log('[SaveOperations] Attempting auto-repair of consistency issues...');
            const repairResult = await villageManager.repairVillageConsistency();
            if (repairResult.result && repairResult.result.success) {
                console.log(`[SaveOperations] ✅ Repair successful: ${repairResult.result.created} villages created, ${repairResult.result.assigned} people assigned`);

                // Refresh data maps after repair to save the correct state
                Object.assign(allTileData, await storage.hgetall('tile') || {});
                Object.assign(allLandsData, await storage.hgetall('tile:lands') || {});
                Object.assign(allVillageData, await storage.hgetall('village') || {});
                // People might have been updated during assignment
                allPeopleData = await storage.hgetall('person') || {};
                // Families might have been created during repair
                allFamilyData = await storage.hgetall('family') || {};

                // Re-parse people and rebuild villageHasResidents in single pass (optimized)
                const reparsed = preParsePeopleData(allPeopleData, logError, ErrorSeverity);
                parsedPeople = reparsed.parsedPeople;
                villageHasResidents = reparsed.villageHasResidents;

                // Clear and refill filtered set
                for (const key in filteredVillageData) delete filteredVillageData[key];
                for (const [villageId, villageJson] of Object.entries(allVillageData)) {
                    if (villageHasResidents[villageId]) {
                        filteredVillageData[villageId] = villageJson as string;
                    }
                }

                // Recalculate counts after repair
                villageCount = Object.keys(filteredVillageData).length;
                peopleCount = parsedPeople.size;
                familyCount = Object.keys(allFamilyData).length;
                console.log(`[SaveOperations] Post-repair counts: Villages=${villageCount}, People=${peopleCount}, Families=${familyCount}`);
            } else {
                console.error('[SaveOperations] ❌ Repair failed - aborting save to prevent inconsistent state');
                throw new Error('Village consistency repair failed - cannot safely proceed with save');
            }
        }

        let tilesSaved = 0;
        let landsSaved = 0;
        let villagesInserted = 0;
        let insertedCount = 0;
        let familiesInserted = 0;
        const peopleFamilyLinks: PersonFamilyLink[] = [];
        let peopleLinkedToFamilies = 0;
        let transactionAborted = false;

        // ========== STEP 0: Clear ALL Postgres tables before saving (full replace, not merge) ==========
        // Order matters due to foreign keys: people -> families -> villages -> tiles_lands -> tiles
        await client.query('TRUNCATE TABLE people RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE family RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE villages RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE tiles_lands RESTART IDENTITY CASCADE');
        await client.query('TRUNCATE TABLE tiles RESTART IDENTITY CASCADE');

        // ========== STEP 1: Save tiles ==========
        if (tileCount > 0) {
            const TILE_BATCH_SIZE = 500; // Batch tiles to avoid huge parameter lists
            const tileEntries = Object.entries(allTileData);

            for (let i = 0; i < tileEntries.length; i += TILE_BATCH_SIZE) {
                const batch = tileEntries.slice(i, i + TILE_BATCH_SIZE);
                const tileValues: string[] = [];
                const tileParams: (number | string | boolean | null)[] = [];
                let paramIndex = 1;

                for (const [tileId, tileJson] of batch) {
                    const tile = JSON.parse(tileJson as string);
                    const boundaryPoints = tile.boundary_points !== undefined && tile.boundary_points !== null
                        ? JSON.stringify(tile.boundary_points)
                        : '[]';
                    const neighborIds = tile.neighbor_ids !== undefined && tile.neighbor_ids !== null
                        ? JSON.stringify(tile.neighbor_ids)
                        : '[]';
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
                        boundaryPoints,
                        neighborIds,
                        tile.biome,
                        tile.fertility
                    );
                    paramIndex += 13;
                }

                if (tileValues.length > 0) {
                    await client.query(`
                        INSERT INTO tiles (id, center_x, center_y, center_z, latitude, longitude, terrain_type, is_land, is_habitable, boundary_points, neighbor_ids, biome, fertility)
                        VALUES ${tileValues.join(', ')}
                    `, tileParams);
                    tilesSaved += tileValues.length;
                }
            }

            // Prepare lands data for batch insert
            const LAND_BATCH_SIZE = 5000;
            const landValues: string[] = [];
            const landParams: (number | string | boolean)[] = [];
            let landParamIndex = 1;

            for (const [tileId, landsJson] of Object.entries(allLandsData)) {
                const lands = JSON.parse(landsJson as string);
                for (const land of lands) {
                    landValues.push(`($${landParamIndex}, $${landParamIndex + 1}, $${landParamIndex + 2}, $${landParamIndex + 3})`);
                    landParams.push(land.tile_id, land.chunk_index, land.land_type, land.cleared);
                    landParamIndex += 4;

                    // Insert in batches
                    if (landValues.length >= LAND_BATCH_SIZE) {
                        await client.query(
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
                await client.query(
                    `INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared) VALUES ${landValues.join(', ')}`,
                    landParams
                );
                landsSaved += landValues.length;
            }

            // Clear the regeneration flag since we just saved tiles
            await storage.del('pending:tiles:regenerate');
        }

        // ========== STEP 2: Save ALL villages from Redis (filtered: only villages with residents) ========== 
        if (villageCount > 0) {
            const VILLAGE_BATCH_SIZE = 500;
            const villageEntries = Object.entries(filteredVillageData);
            const villageRefs: Array<{ id: number; tile_id: number; land_chunk_index: number }> = [];

            for (let i = 0; i < villageEntries.length; i += VILLAGE_BATCH_SIZE) {
                const batch = villageEntries.slice(i, i + VILLAGE_BATCH_SIZE);
                const values: string[] = [];
                const params: (number | string | null)[] = [];
                let paramIdx = 1;

                for (const [id, json] of batch) {
                    try {
                        const v = JSON.parse(json as string);
                        values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8})`);
                        params.push(
                            v.id,
                            v.tile_id,
                            v.land_chunk_index,
                            v.name || 'Village',
                            JSON.stringify(v.housing_slots || []),
                            v.housing_capacity || 1000,
                            v.food_stores || 0,
                            v.food_capacity || 100000,
                            v.food_production_rate || 50
                        );
                        paramIdx += 9;
                        villageRefs.push({ id: v.id, tile_id: v.tile_id, land_chunk_index: v.land_chunk_index });
                    } catch (e: unknown) {
                        console.warn(`Failed to parse village ${id}:`, (e as Error).message);
                    }
                }

                if (values.length > 0) {
                    try {
                        await client.query(`
                            INSERT INTO villages (id, tile_id, land_chunk_index, name, housing_slots, housing_capacity, food_stores, food_capacity, food_production_rate)
                            VALUES ${values.join(', ')}
                        `, params);
                        villagesInserted += values.length;
                    } catch (e: unknown) {
                        console.warn('Village batch insert failed:', (e as Error).message);
                    }
                }
            }

            // Batch update tiles_lands village references
            if (villageRefs.length > 0) {
                const UPDATE_BATCH_SIZE = 500;
                for (let i = 0; i < villageRefs.length; i += UPDATE_BATCH_SIZE) {
                    const batch = villageRefs.slice(i, i + UPDATE_BATCH_SIZE);
                    const values: string[] = [];
                    const params: number[] = [];
                    let paramIdx = 1;

                    for (const ref of batch) {
                        values.push(`($${paramIdx}::int, $${paramIdx + 1}::int, $${paramIdx + 2}::int)`);
                        params.push(ref.id, ref.tile_id, ref.land_chunk_index);
                        paramIdx += 3;
                    }

                    try {
                        await client.query(`
                            UPDATE tiles_lands
                            SET village_id = data.village_id
                            FROM (VALUES ${values.join(', ')}) AS data(village_id, tile_id, chunk_index)
                            WHERE tiles_lands.tile_id = data.tile_id AND tiles_lands.chunk_index = data.chunk_index
                        `, params);
                    } catch (err: unknown) {
                        logError(err, `SaveOperations:BatchUpdateTileLandVillageRef`, ErrorSeverity.MEDIUM);
                    }
                }
            }
        }

        // ========== STEP 3: Save ALL people from pre-parsed data (optimized - no re-parsing) ==========
        if (peopleCount > 0 && !transactionAborted) {
            const peopleBatchSize = 2000; // Larger batches for better performance
            const peopleEntries = Array.from(parsedPeople.entries());

            for (let i = 0; i < peopleEntries.length && !transactionAborted; i += peopleBatchSize) {
                const batch = peopleEntries.slice(i, i + peopleBatchSize);
                const values: string[] = [];
                const params: (number | string | boolean | null)[] = [];
                let paramIdx = 1;

                for (const [id, p] of batch) {
                    const personId = Number(p.id);
                    if (Number.isNaN(personId)) {
                        continue;
                    }
                    const tileId = p.tile_id !== undefined && p.tile_id !== null ? Number(p.tile_id) : null;
                    const residency = p.residency !== undefined && p.residency !== null ? Number(p.residency) : null;
                    const numericFamilyId = p.family_id !== undefined && p.family_id !== null ? Number(p.family_id) : null;
                    if (numericFamilyId !== null && !Number.isNaN(numericFamilyId) && allFamilyData[String(numericFamilyId)]) {
                        peopleFamilyLinks.push({ personId, familyId: numericFamilyId });
                    }
                    // Convert sex to boolean: "M"/true = true (male), "F"/false = false (female)
                    const sexBool = p.sex === 'M' || p.sex === true;
                    values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})`);
                    params.push(personId, tileId, sexBool, p.date_of_birth, residency, null);
                    paramIdx += 6;
                }

                if (values.length > 0) {
                    try {
                        await client.query(`
                            INSERT INTO people (id, tile_id, sex, date_of_birth, residency, family_id)
                            VALUES ${values.join(',')}
                        `, params);
                        insertedCount += values.length;
                    } catch (e: unknown) {
                        const errMsg = (e as Error).message;
                        console.warn('People batch insert failed:', errMsg);
                        if (errMsg.includes('transazione corrente') || errMsg.includes('current transaction is aborted')) {
                            transactionAborted = true;
                        }
                    }
                }
            }
        }

        // ========== STEP 4: Save ALL families from Redis ==========
        // Build set of valid person IDs from pre-parsed data (optimized)
        const validPersonIds = new Set<number>();
        for (const personId of parsedPeople.keys()) {
            const numId = Number(personId);
            if (!Number.isNaN(numId)) {
                validPersonIds.add(numId);
            }
        }
        let skippedFamilies = 0;

        if (familyCount > 0) {
            const FAMILY_BATCH_SIZE = 1000;
            const familyEntries = Object.entries(allFamilyData);

            for (let i = 0; i < familyEntries.length && !transactionAborted; i += FAMILY_BATCH_SIZE) {
                const batch = familyEntries.slice(i, i + FAMILY_BATCH_SIZE);
                const values: string[] = [];
                const params: (number | string | boolean | null)[] = [];
                let paramIdx = 1;

                for (const [id, json] of batch) {
                    try {
                        const f = JSON.parse(json as string);
                        // Validate spouse IDs exist in people data to prevent FK constraint violations
                        const husbandId = f.husband_id ? Number(f.husband_id) : null;
                        const wifeId = f.wife_id ? Number(f.wife_id) : null;
                        
                        if (husbandId !== null && !validPersonIds.has(husbandId)) {
                            console.warn(`[SaveOperations] Skipping family ${f.id}: husband_id ${husbandId} not found in people`);
                            skippedFamilies++;
                            continue;
                        }
                        if (wifeId !== null && !validPersonIds.has(wifeId)) {
                            console.warn(`[SaveOperations] Skipping family ${f.id}: wife_id ${wifeId} not found in people`);
                            skippedFamilies++;
                            continue;
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
                    } catch (e: unknown) {
                        console.warn(`Failed to parse family ${id}:`, (e as Error).message);
                    }
                }

                if (values.length > 0) {
                    try {
                        await client.query(`
                            INSERT INTO family (id, husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                            VALUES ${values.join(', ')}
                        `, params);
                        familiesInserted += values.length;
                    } catch (e: unknown) {
                        const errMsg = (e as Error).message;
                        console.warn('Family batch insert failed:', errMsg);
                        // Check if transaction was aborted - if so, stop processing
                        if (errMsg.includes('transazione corrente') || errMsg.includes('current transaction is aborted')) {
                            transactionAborted = true;
                        }
                    }
                }
            }
            
            if (skippedFamilies > 0) {
                console.warn(`[SaveOperations] Skipped ${skippedFamilies} families with invalid spouse references`);
            }
        }

        // ========== STEP 4b: Restore people -> family links now that families exist ==========
        if (peopleFamilyLinks.length > 0 && !transactionAborted) {
            const LINK_BATCH_SIZE = 2000;
            for (let i = 0; i < peopleFamilyLinks.length && !transactionAborted; i += LINK_BATCH_SIZE) {
                const batch = peopleFamilyLinks.slice(i, i + LINK_BATCH_SIZE);
                const values: string[] = [];
                const params: number[] = [];
                let paramIdx = 1;

                for (const link of batch) {
                    values.push(`($${paramIdx}::int, $${paramIdx + 1}::int)`);
                    params.push(link.personId, link.familyId);
                    paramIdx += 2;
                }

                if (values.length > 0) {
                    try {
                        await client.query(`
                            UPDATE people
                            SET family_id = data.family_id,
                                updated_at = CURRENT_TIMESTAMP
                            FROM (VALUES ${values.join(', ')}) AS data(id, family_id)
                            WHERE people.id = data.id
                        `, params);
                        peopleLinkedToFamilies += batch.length;
                    } catch (e: unknown) {
                        const errMsg = (e as Error).message;
                        console.warn(`⚠️ Failed to link ${batch.length} people to families: ${errMsg}`);
                        if (errMsg.includes('transazione corrente') || errMsg.includes('current transaction is aborted')) {
                            transactionAborted = true;
                        }
                    }
                }
            }
        }

        // Clear all pending operation sets since we just saved everything
        await PopulationState.clearPendingOperations();
        await PopulationState.clearPendingFamilyOperations();
        try {
            await storage.del('pending:village:inserts');
        } catch (err: unknown) {
            logError(err, 'SaveOperations:ClearPendingVillageInserts', ErrorSeverity.LOW);
        }

        const elapsed = Date.now() - startTime;

        if (transactionAborted) {
            await client.query('ROLLBACK');
            console.error(`❌ [PostgreSQL] Save failed after ${elapsed}ms due to transaction abort. Partial data not committed.`);
            throw new Error('Save transaction was aborted due to FK constraint violations');
        }

        await client.query('COMMIT');

        console.log(`💾 [PostgreSQL] Saved in ${elapsed}ms — Tiles: ${tilesSaved}, Lands: ${landsSaved}, Villages: ${villagesInserted}, People: ${insertedCount}, Families: ${familiesInserted}`);

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
        await emitPopulationUpdate(context.io ?? null);

        // Save calendar state to database
        if (context.calendarService && typeof context.calendarService.saveStateToDB === 'function') {
            try {
                await context.calendarService.saveStateToDB();
            } catch (err: unknown) {
                console.warn('⚠️ Failed to save calendar state:', (err as Error).message);
            }
        }

        // Save Rust simulation state
        try {
            await saveRustSimulationState();
        } catch (err: unknown) {
            console.warn('⚠️ Failed to save Rust simulation state:', (err as Error).message);
        }

        return {
            tiles: tilesSaved,
            lands: landsSaved,
            villages: villagesInserted,
            people: insertedCount,
            families: familiesInserted,
            elapsed,
            familyLinks: peopleLinkedToFamilies
        };
    } catch (err: unknown) {
        console.error('❌ [SaveOperations] Transaction failed, rolling back:', (err as Error).message);
        try {
            await client.query('ROLLBACK');
            console.log('✅ [SaveOperations] Transaction rolled back successfully');
        } catch (rollbackErr: unknown) {
            console.error('❌ [SaveOperations] CRITICAL: Rollback failed:', (rollbackErr as Error).message);
        }
        throw err;
    } finally {
        client.release();
        // Resume calendar ticks after save
        if (wasRunning && context.calendarService) {
            context.calendarService.start();
        }
    }
}

/**
 * Emit population update after save
 */
async function emitPopulationUpdate(io: SocketIOServer | null): Promise<void> {
    try {
        const { getAllPopulationData } = require('../population/PopStats');
        const populationData = await getAllPopulationData(pool, null, null);
        if (io) {
            io.emit('populationUpdate', populationData);
        }
    } catch (err: unknown) {
        console.warn('⚠️ Could not emit populationUpdate after save:', (err as Error).message);
    }
}

export {
    saveToDatabase,
    saveRustSimulationState,
    emitPopulationUpdate
};
