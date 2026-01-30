/**
 * State Manager - Load Operations
 * Handles loading state from PostgreSQL into storage on server start
 */

const storage = require('../storage');
const pool = require('../../config/database');

/**
 * Load all data from PostgreSQL into storage on server start
 * @param {Object} context - StateManager context with calendarService, io
 * @returns {Promise<Object>} Load results
 */
async function loadFromDatabase(context) {
    if (!storage.isAvailable()) {
        console.warn('⚠️ storage not available, skipping state load');
        return { villages: 0, people: 0, families: 0, skipped: true };
    }

    // Redis-first mode: do not touch Postgres or flush Redis. If Redis already has data, keep it.
    if (process.env.REDIS_FIRST === 'true') {
        console.log('[StateManager] REDIS_FIRST=true, skipping Postgres load and Redis flush');

        // Resume calendar if we paused it earlier
        let calendarWasRunning = false;
        if (context.calendarService && context.calendarService.state) {
            calendarWasRunning = context.calendarService.state.isRunning;
        }
        if (calendarWasRunning && context.calendarService && typeof context.calendarService.start === 'function') {
            context.calendarService.start();
        }

        // Return current Redis counts for visibility
        const villageCount = typeof storage.hlen === 'function' ? await storage.hlen('village') : 0;
        const personCount = typeof storage.hlen === 'function' ? await storage.hlen('person') : 0;
        const familyCount = typeof storage.hlen === 'function' ? await storage.hlen('family') : 0;
        return { villages: villageCount, people: personCount, families: familyCount, skipped: true };
    }

    // Stop calendar during loading to prevent time progression
    let calendarWasRunning = false;
    if (context.calendarService && typeof context.calendarService.stop === 'function') {
        calendarWasRunning = context.calendarService.state.isRunning;
        if (calendarWasRunning) {
            context.calendarService.stop();
            console.log('⏸️ Calendar paused during world loading');
        }
    }

    // Reload calendar state from database
    if (context.calendarService && typeof context.calendarService.loadStateFromDB === 'function') {
        await context.calendarService.loadStateFromDB();
    }

    // Clear existing storage state keys to avoid stale data
    await clearExistingStorageState();

    const pipeline = storage.pipeline();

    // Load tiles from Postgres into Redis
    const tiles = await loadTiles(pipeline);

    // Load tiles_lands from Postgres into Redis
    const tilesLands = await loadTilesLands(pipeline);

    // Load villages
    const villages = await loadVillages(pipeline);

    // Load people and count demographics
    const { people, maleCount, femaleCount } = await loadPeople(pipeline);

    // Load families
    const families = await loadFamilies(pipeline);

    // Populate fertile family candidates
    await populateFertileFamilies(families, people, context.calendarService);

    // Load cleared land counts
    await loadClearedLandCounts(pipeline);

    // Set global population counts
    pipeline.hset('counts:global', 'total', people.length.toString());
    pipeline.hset('counts:global', 'male', maleCount.toString());
    pipeline.hset('counts:global', 'female', femaleCount.toString());
    pipeline.hset('counts:global', 'nextTempId', '-1');
    pipeline.hset('counts:global', 'nextFamilyTempId', '-1');

    await pipeline.exec();

    // Populate eligible matchmaking sets
    await populateEligibleSets(people, context.calendarService);
    // Defensive repair: rebuild village membership sets to match authoritative 'person' hash
    try {
        const PeopleState = require('../populationState/PeopleState');
        const repairRes = await PeopleState.rebuildVillageMemberships();
        if (repairRes && repairRes.success) {
            // Village membership sets rebuilt successfully
        } else {
            console.warn('[StateManager] Rebuild village membership sets reported:', repairRes);
        }
    } catch (e) {
        console.warn('[StateManager] Failed to run rebuildVillageMemberships:', e && e.message ? e.message : e);
    }

    // Verify villages match people's tiles - if not, regenerate villages
    if (people.length > 0 && villages.length > 0) {
        const peopleTileIds = new Set(people.map(p => p.tile_id).filter(Boolean));
        const villageTileIds = new Set(villages.map(v => v.tile_id).filter(Boolean));
        
        // Check if there's any overlap
        let hasOverlap = false;
        for (const tileId of peopleTileIds) {
            if (villageTileIds.has(tileId)) {
                hasOverlap = true;
                break;
            }
        }
        
        if (!hasOverlap) {
            console.warn(`[StateManager] ⚠️ Villages don't match people's tiles! Regenerating villages...`);
            console.warn(`[StateManager] People tiles: ${[...peopleTileIds].slice(0, 5).join(', ')}...`);
            console.warn(`[StateManager] Village tiles: ${[...villageTileIds].slice(0, 5).join(', ')}...`);
            
            // Clear old villages and regenerate
            await storage.del('village');
            const { seedVillagesStorageFirst } = require('../villageSeeder/redisSeeding');
            const reseeded = await seedVillagesStorageFirst();
            // Note: seedVillagesStorageFirst already calls assignResidencyStorage internally
            if (reseeded.created > 0) {
                console.log(`[StateManager] ✅ Regenerated ${reseeded.created} villages for loaded people`);
            }
        }
    }

    // If Redis is empty after loading from Postgres, seed a new world
    let seedResult = null;
    if (people.length === 0) {
        console.log('[StateManager] No people loaded from Postgres, seeding new world...');
        const { seedWorldIfEmpty } = require('../villageSeeder/redisSeeding');
        seedResult = await seedWorldIfEmpty();
    }

    // Restart calendar if it was running before loading
    if (calendarWasRunning && context.calendarService && typeof context.calendarService.start === 'function') {
        context.calendarService.start();
        console.log('▶️ Calendar resumed after world loading');
    }

    // Return loaded counts, or seeded counts if we seeded
    if (seedResult && seedResult.seeded) {
        return {
            villages: seedResult.villages,
            people: seedResult.people,
            families: 0,
            male: 0,
            female: 0,
            tiles: seedResult.tiles,
            tilesLands: 0,
            seeded: true
        };
    }

    return {
        villages: villages.length,
        people: people.length,
        families: families.length,
        male: maleCount,
        female: femaleCount,
        tiles: tiles.length,
        tilesLands: tilesLands
    };
}

async function clearExistingStorageState() {
    console.log('🧹 Starting clearExistingStorageState...');
    try {
        // Check what keys exist before flush (guard for tests/mocks that don't implement it)
        let keysBefore = [];
        if (typeof storage.keys === 'function') {
            keysBefore = await storage.keys('*') || [];
        }
        console.log(`🧹 Keys before flush: ${keysBefore.length} keys`);

        // Flush the entire Redis database to ensure clean state (guard when not supported)
        if (typeof storage.flushdb === 'function') {
            const flushResult = await storage.flushdb();
            console.log(`🧹 flushdb() returned: ${flushResult}`);
            console.log('🧹 Flushed entire Redis database for clean state load');
        } else {
            throw new Error('flushdb not supported');
        }

        // Check what keys exist after flush (guard for tests/mocks that don't implement it)
        let keysAfter = [];
        if (typeof storage.keys === 'function') {
            keysAfter = await storage.keys('*') || [];
        }
        console.log(`🧹 Keys after flush: ${keysAfter.length} keys`);
        
        if (keysAfter.length > 0) {
            console.warn(`⚠️ WARNING: ${keysAfter.length} keys still exist after flushdb! Keys: ${keysAfter.slice(0, 10).join(', ')}${keysAfter.length > 10 ? '...' : ''}`);
        }
    } catch (e) {
        console.warn('⚠️ Failed to flush Redis database:', e && e.message ? e.message : e);
        // Fallback to comprehensive selective clearing
        try {
            // Clear all known hash keys
            await storage.del(
                'village', 'person', 'family', 
                'tile', 'tile:lands', 'tile:fertility',
                'village:cleared', 'counts:global'
            );

            // Clear all pattern-based keys using scanStream
            const patterns = [
                'village:*:*:people',   // Village population sets
                'eligible:*:*',         // Eligible matchmaking sets
                'pending:*',            // All pending operations
                'fertile:*',            // Fertile family sets
                'lock:*',               // Any stale locks
                'stats:*'               // Statistics counters
            ];

            for (const pattern of patterns) {
                try {
                    const stream = storage.scanStream({ match: pattern, count: 1000 });
                    const keysToDelete = [];
                    for await (const resultKeys of stream) {
                        for (const key of resultKeys) keysToDelete.push(key);
                    }
                    if (keysToDelete.length > 0) {
                        // Delete in batches of 100 to avoid overwhelming Redis
                        for (let i = 0; i < keysToDelete.length; i += 100) {
                            const batch = keysToDelete.slice(i, i + 100);
                            await storage.del(...batch);
                        }
                        console.log(`🧹 Cleared ${keysToDelete.length} keys matching '${pattern}'`);
                    }
                } catch (scanErr) {
                    console.warn(`⚠️ Failed to clear keys matching '${pattern}':`, scanErr.message);
                }
            }

            console.log('🧹 Cleared existing storage state keys (fallback method)');
        } catch (e2) {
            console.warn('⚠️ Failed to clear storage keys even with fallback:', e2 && e2.message ? e2.message : e2);
        }
    }
}

/**
 * Load tiles from PostgreSQL into storage pipeline
 */
async function loadTiles(pipeline) {
    const { rows: tiles } = await pool.query('SELECT * FROM tiles');
    for (const t of tiles) {
        pipeline.hset('tile', t.id.toString(), JSON.stringify({
            id: t.id,
            center_x: t.center_x,
            center_y: t.center_y,
            center_z: t.center_z,
            latitude: t.latitude,
            longitude: t.longitude,
            terrain_type: t.terrain_type,
            is_land: t.is_land,
            is_habitable: t.is_habitable,
            boundary_points: t.boundary_points,
            neighbor_ids: t.neighbor_ids,
            biome: t.biome,
            fertility: t.fertility
        }));
        if (t.fertility !== null) {
            pipeline.hset('tile:fertility', t.id.toString(), t.fertility.toString());
        }
    }
    return tiles;
}

/**
 * Load tiles_lands from PostgreSQL into storage pipeline (grouped by tile_id)
 */
async function loadTilesLands(pipeline) {
    const { rows: lands } = await pool.query('SELECT * FROM tiles_lands ORDER BY tile_id, chunk_index');

    // Group lands by tile_id
    const landsByTile = {};
    for (const land of lands) {
        const tileId = land.tile_id.toString();
        if (!landsByTile[tileId]) landsByTile[tileId] = [];
        landsByTile[tileId].push({
            tile_id: land.tile_id,
            chunk_index: land.chunk_index,
            land_type: land.land_type,
            cleared: land.cleared,
            owner_id: land.owner_id,
            village_id: land.village_id
        });
    }

    // Store grouped lands in Redis
    for (const [tileId, tileLands] of Object.entries(landsByTile)) {
        pipeline.hset('tile:lands', tileId, JSON.stringify(tileLands));
    }

    return lands.length;
}

/**
 * Load villages from PostgreSQL into storage pipeline
 */
async function loadVillages(pipeline) {
    const { rows: villages } = await pool.query('SELECT * FROM villages');
    for (const v of villages) {
        let housingSlots = [];
        try {
            if (Array.isArray(v.housing_slots)) {
                housingSlots = v.housing_slots;
            } else if (v.housing_slots) {
                housingSlots = JSON.parse(v.housing_slots);
                if (!Array.isArray(housingSlots)) housingSlots = [];
            }
        } catch (_) {
            housingSlots = [];
        }

        pipeline.hset('village', v.id.toString(), JSON.stringify({
            id: v.id,
            tile_id: v.tile_id,
            land_chunk_index: v.land_chunk_index,
            name: v.name,
            food_stores: (parseFloat(v.food_stores) || 0),
            food_capacity: parseInt(v.food_capacity) || 1000,
            food_production_rate: (parseFloat(v.food_production_rate) || 0),
            housing_capacity: parseInt(v.housing_capacity) || 100,
            housing_slots: housingSlots,
        }));
    }
    return villages;
}

/**
 * Load people from PostgreSQL into storage pipeline
 */
async function loadPeople(pipeline) {
    const { rows: people } = await pool.query('SELECT * FROM people');
    let maleCount = 0, femaleCount = 0;

    for (const p of people) {
        // Normalize sex to boolean
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

    return { people, maleCount, femaleCount };
}

/**
 * Load families from PostgreSQL into storage pipeline
 */
async function loadFamilies(pipeline) {
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
    return families;
}

/**
 * Populate fertile family candidates from loaded families
 */
async function populateFertileFamilies(families, people, calendarService) {
    try {
        const peopleMap = {};
        for (const p of people) peopleMap[p.id] = p;

        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getState === 'function') {
            const cs = calendarService.getState();
            if (cs && cs.currentDate) currentDate = cs.currentDate;
        }

        const PopulationState = require('../populationState');
        for (const f of families) {
            try {
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
}

/**
 * Load cleared land counts per village
 */
async function loadClearedLandCounts(pipeline) {
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
}

/**
 * Populate eligible matchmaking sets based on loaded people
 */
async function populateEligibleSets(people, calendarService) {
    try {
        const PopulationState = require('../populationState');
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getState === 'function') {
            const cs = calendarService.getState();
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
}

module.exports = {
    loadFromDatabase,
    clearExistingStorageState,
    loadTiles,
    loadTilesLands,
    loadVillages,
    loadPeople,
    loadFamilies,
    populateFertileFamilies,
    loadClearedLandCounts,
    populateEligibleSets
};
