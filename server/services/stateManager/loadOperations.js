/**
 * State Manager - Load Operations
 * Handles loading state from PostgreSQL into Redis on server start
 */

const redis = require('../../config/redis');
const { isRedisAvailable } = require('../../config/redis');
const pool = require('../../config/database');

/**
 * Load all data from PostgreSQL into Redis on server start
 * @param {Object} context - StateManager context with calendarService, io
 * @returns {Promise<Object>} Load results
 */
async function loadFromDatabase(context) {
    if (!isRedisAvailable()) {
        console.warn('⚠️ Redis not available, skipping state load');
        return { villages: 0, people: 0, families: 0, skipped: true };
    }

    console.log('📥 Loading state from PostgreSQL to Redis...');

    // Clear existing Redis state keys to avoid stale data
    await clearExistingRedisState();

    const pipeline = redis.pipeline();

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

    console.log(`✅ Loaded ${villages.length} villages, ${people.length} people (${maleCount} male, ${femaleCount} female), ${families.length} families to Redis`);

    // Populate eligible matchmaking sets
    await populateEligibleSets(people, context.calendarService);

    return {
        villages: villages.length,
        people: people.length,
        families: families.length,
        male: maleCount,
        female: femaleCount
    };
}

/**
 * Clear existing Redis state keys to avoid stale data
 */
async function clearExistingRedisState() {
    try {
        await redis.del(
            'village', 'person', 'family', 'tile:fertility',
            'village:cleared', 'counts:global', 'pending:inserts',
            'pending:deletes', 'pending:family:inserts', 'pending:family:updates'
        );

        // Clear all village:*:*:people sets
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
}

/**
 * Load villages from PostgreSQL into Redis pipeline
 */
async function loadVillages(pipeline) {
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
    return villages;
}

/**
 * Load people from PostgreSQL into Redis pipeline
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
 * Load families from PostgreSQL into Redis pipeline
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
    clearExistingRedisState,
    loadVillages,
    loadPeople,
    loadFamilies,
    populateFertileFamilies,
    loadClearedLandCounts,
    populateEligibleSets
};
