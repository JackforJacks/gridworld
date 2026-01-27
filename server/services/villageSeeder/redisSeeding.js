/**
 * Village Seeder - Redis-first Seeding
 * Handles village seeding using Redis as the primary store
 */

const pool = require('../../config/database');
const redis = require('../../config/redis');
const { isRedisAvailable } = require('../../config/redis');
const { ensureVillageIdColumn } = require('./dbUtils');
const { seedRandomVillages } = require('./postgresSeeding');

/**
 * Redis-first village seeding - reads population from Redis, writes villages to Redis
 * @returns {Promise<Object>} Result with created count and villages
 */
async function seedVillagesRedisFirst() {
    if (!isRedisAvailable()) {
        console.warn('[villageSeeder] Redis not available - falling back to Postgres seeding');
        return seedRandomVillages();
    }

    await ensureVillageIdColumn();
    const perTileMax = 30;
    const housingCapacity = 1000;

    try {
        const PopulationState = require('../populationState');

        // Get population counts per tile from Redis
        const tilePopulations = await PopulationState.getAllTilePopulations();
        const populatedTileIds = Object.keys(tilePopulations).filter(id => tilePopulations[id] > 0);

        if (populatedTileIds.length === 0) {
            console.log('[villageSeeder] No populated tiles in Redis');
            return { created: 0, villages: [] };
        }

        console.log(`[villageSeeder] Found ${populatedTileIds.length} populated tiles in Redis`);

        // Clear existing villages in Redis
        await redis.del('village');

        // Get cleared chunks from Postgres
        const { rows: allChunks } = await pool.query(`
            SELECT tl.tile_id, tl.chunk_index
            FROM tiles_lands tl
            WHERE tl.tile_id = ANY($1) AND tl.land_type = 'cleared'
            ORDER BY tl.tile_id, RANDOM()
        `, [populatedTileIds.map(id => parseInt(id))]);

        // Group chunks by tile_id
        const chunksByTile = {};
        for (const chunk of allChunks) {
            if (!chunksByTile[chunk.tile_id]) chunksByTile[chunk.tile_id] = [];
            chunksByTile[chunk.tile_id].push(chunk.chunk_index);
        }

        // Generate villages in memory
        const allVillages = [];

        for (const tileIdStr of populatedTileIds) {
            const tileId = parseInt(tileIdStr);
            const tilePopulation = tilePopulations[tileIdStr];
            let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
            desiredVillages = Math.max(1, Math.min(perTileMax, desiredVillages));

            const availableChunks = chunksByTile[tileId] || [];
            const chunksToUse = availableChunks.slice(0, desiredVillages);

            for (const chunkIndex of chunksToUse) {
                const tempId = await PopulationState.getNextTempId();
                const village = {
                    id: tempId,
                    tile_id: tileId,
                    land_chunk_index: chunkIndex,
                    name: `Village ${tileId}-${chunkIndex}`,
                    housing_slots: [],
                    housing_capacity: housingCapacity,
                    food_stores: 100,
                    food_capacity: 1000,
                    food_production_rate: 0.5
                };
                allVillages.push(village);
            }
        }

        // Write all villages to Redis
        const pipeline = redis.pipeline();
        for (const village of allVillages) {
            pipeline.hset('village', village.id.toString(), JSON.stringify(village));
        }
        // Track for pending inserts to Postgres
        for (const village of allVillages) {
            pipeline.sadd('pending:village:inserts', village.id.toString());
        }
        await pipeline.exec();

        console.log(`[villageSeeder] Created ${allVillages.length} villages in Redis (pending Postgres save)`);

        // Assign residency to people in Redis
        await assignResidencyRedis(populatedTileIds, allVillages);

        return { created: allVillages.length, villages: allVillages };
    } catch (err) {
        console.error('[villageSeeder] Redis-first seeding failed:', err);
        throw err;
    }
}

/**
 * Assign residency to people in Redis
 */
async function assignResidencyRedis(populatedTileIds, allVillages) {
    try {
        const PopulationState = require('../populationState');

        // Group villages by tile
        const villagesByTile = {};
        for (const v of allVillages) {
            if (!villagesByTile[v.tile_id]) villagesByTile[v.tile_id] = [];
            villagesByTile[v.tile_id].push(v);
        }

        // Get all people from Redis
        const allPeople = await PopulationState.getAllPeople();

        // Group people by tile
        const peopleByTile = {};
        for (const p of allPeople) {
            if (p.tile_id) {
                if (!peopleByTile[p.tile_id]) peopleByTile[p.tile_id] = [];
                peopleByTile[p.tile_id].push(p);
            }
        }

        // Assign people to villages
        for (const tileIdStr of populatedTileIds) {
            const tileId = parseInt(tileIdStr);
            const villages = villagesByTile[tileId] || [];
            const people = peopleByTile[tileId] || [];

            // Clear existing residency
            const clearPipeline = redis.pipeline();
            for (const p of people) {
                if (p.residency !== null && p.residency !== undefined) {
                    clearPipeline.srem(`village:${p.tile_id}:${p.residency}:people`, p.id.toString());
                    await PopulationState.updatePerson(p.id, { residency: null });
                }
            }
            await clearPipeline.exec();

            // Shuffle people for random distribution
            for (let i = people.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [people[i], people[j]] = [people[j], people[i]];
            }

            let peopleIndex = 0;
            for (const village of villages) {
                const available = village.housing_capacity - (village.housing_slots ? village.housing_slots.length : 0);
                if (available <= 0 || peopleIndex >= people.length) continue;

                const toAssign = Math.min(available, people.length - peopleIndex);
                const assignedPeople = people.slice(peopleIndex, peopleIndex + toAssign);

                // Update people with residency in Redis
                const personWritePipeline = redis.pipeline();
                for (const person of assignedPeople) {
                    const pid = person.id;
                    await PopulationState.updatePerson(pid, { residency: village.land_chunk_index });
                    personWritePipeline.sadd(`village:${village.tile_id}:${village.land_chunk_index}:people`, pid.toString());
                    village.housing_slots.push(pid);
                }
                await personWritePipeline.exec();

                // Update village housing_slots in Redis
                await redis.hset('village', village.id.toString(), JSON.stringify(village));

                peopleIndex += toAssign;
            }
        }

        console.log(`[villageSeeder] Assigned residency to people in Redis`);
    } catch (err) {
        console.error('[villageSeeder] Failed to assign residency in Redis:', err);
    }
}

module.exports = {
    seedVillagesRedisFirst,
    assignResidencyRedis
};
