/**
 * Village Seeder - storage-first Seeding
 * Handles village seeding using storage (Redis or memory) as the primary store
 */

const pool = require('../../config/database');
const storage = require('../storage');
const { ensureVillageIdColumn } = require('./dbUtils');
const { seedRandomVillages } = require('./postgresSeeding');
const idAllocator = require('../idAllocator');

/**
 * Redis-first village seeding - reads population from Redis, writes villages to Redis
 * @returns {Promise<Object>} Result with created count and villages
 */
async function seedVillagesStorageFirst() {
    if (!storage.isAvailable()) {
        console.warn('[villageSeeder] storage not available - falling back to Postgres seeding');
        return seedRandomVillages();
    }

    await ensureVillageIdColumn();
    const perTileMax = 30;
    const housingCapacity = 1000;

    try {
        const PopulationState = require('../populationState');

        // Get population counts per tile from Redis
        const tilePopulations = await PopulationState.getAllTilePopulations();
        let populatedTileIds = Object.keys(tilePopulations).filter(id => tilePopulations[id] > 0);

        // If no per-village sets found, try a best-effort fallback: group people by tile_id
        if (populatedTileIds.length === 0) {
            if (require('../../config/server').verboseLogs) console.log('[villageSeeder] No populated tiles found via sets; falling back to grouping people by tile_id');
            let allPeople = await PopulationState.getAllPeople();
            const byTile = {};
            if (!allPeople || allPeople.length === 0) {
                // Last-resort: read raw person hash directly from storage
                try {
                    const peopleRaw = await storage.hgetall('person') || {};
                    allPeople = Object.values(peopleRaw).map(j => {
                        try { return JSON.parse(j); } catch (_) { return null; }
                    }).filter(Boolean);
                } catch (e) {
                    allPeople = [];
                }
            }
            for (const p of allPeople) {
                if (!p || p.tile_id === undefined || p.tile_id === null) continue;
                const tid = String(p.tile_id);
                byTile[tid] = (byTile[tid] || 0) + 1;
            }
            populatedTileIds = Object.keys(byTile).filter(id => byTile[id] > 0);
            // Ensure tilePopulations reflects the fallback counts so downstream
            // logic can compute desired villages per tile.
            tilePopulations = byTile;
            if (populatedTileIds.length === 0) {
                if (require('../../config/server').verboseLogs) console.log('[villageSeeder] Fallback grouping found no populated tiles either');
                return { created: 0, villages: [] };
            }
        }

        if (require('../../config/server').verboseLogs) console.log(`[villageSeeder] Found ${populatedTileIds.length} populated tiles in storage`);

        // Set tile fertility in storage
        const { rows: tileRows } = await pool.query('SELECT id, fertility FROM tiles WHERE id = ANY($1)', [populatedTileIds.map(id => parseInt(id))]);
        for (const row of tileRows) {
            await storage.hset('tile:fertility', row.id.toString(), row.fertility.toString());
        }

        // Clear existing villages in storage
        await storage.del('village');

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

        // Calculate total villages needed
        let totalVillagesNeeded = 0;
        const villageSpecs = []; // {tileId, chunks[]}
        for (const tileIdStr of populatedTileIds) {
            const tileId = parseInt(tileIdStr);
            const tilePopulation = tilePopulations[tileIdStr];
            let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
            desiredVillages = Math.max(1, Math.min(perTileMax, desiredVillages));

            const availableChunks = chunksByTile[tileId] || [];
            const chunksToUse = availableChunks.slice(0, desiredVillages);
            totalVillagesNeeded += chunksToUse.length;
            villageSpecs.push({ tileId, chunks: chunksToUse });
        }

        // Pre-allocate all village IDs in a single batch call
        const villageIds = await idAllocator.getVillageIdBatch(totalVillagesNeeded);
        let villageIdIndex = 0;

        // Generate villages in memory
        const allVillages = [];

        for (const { tileId, chunks } of villageSpecs) {
            for (const chunkIndex of chunks) {
                const villageId = villageIds[villageIdIndex++];
                const village = {
                    id: villageId,
                    tile_id: tileId,
                    land_chunk_index: chunkIndex,
                    name: `Village ${tileId}-${chunkIndex}`,
                    housing_slots: [],
                    housing_capacity: housingCapacity,
                    food_stores: 200,
                    food_capacity: 1000,
                    food_production_rate: 0.5
                };
                allVillages.push(village);
            }
        }

        // Write all villages to storage
        const pipeline = storage.pipeline();
        for (const village of allVillages) {
            pipeline.hset('village', village.id.toString(), JSON.stringify(village));
            // Set initial cleared land for the village (1 chunk, since built on cleared land)
            pipeline.hset('village:cleared', village.id.toString(), '1');
        }
        // Track for pending inserts to Postgres
        for (const village of allVillages) {
            pipeline.sadd('pending:village:inserts', village.id.toString());
        }
        await pipeline.exec();

        const serverConfig = require('../../config/server');
        if (serverConfig.verboseLogs) console.log(`[villageSeeder] Created ${allVillages.length} villages in storage (pending Postgres save)`);

        // Assign residency to people in storage
        await assignResidencyStorage(populatedTileIds, allVillages);

        return { created: allVillages.length, villages: allVillages };
    } catch (err) {
        console.error('[villageSeeder] storage-first seeding failed:', err);
        throw err;
    }
}

/**
 * Assign residency to people in storage (batch optimized)
 */
async function assignResidencyStorage(populatedTileIds, allVillages) {
    try {
        const PopulationState = require('../populationState');

        // Group villages by tile
        const villagesByTile = {};
        for (const v of allVillages) {
            if (!villagesByTile[v.tile_id]) villagesByTile[v.tile_id] = [];
            villagesByTile[v.tile_id].push(v);
        }

        // Get all people from storage
        const allPeople = await PopulationState.getAllPeople();

        // Group people by tile
        const peopleByTile = {};
        for (const p of allPeople) {
            if (p.tile_id) {
                if (!peopleByTile[p.tile_id]) peopleByTile[p.tile_id] = [];
                peopleByTile[p.tile_id].push(p);
            }
        }

        // Collect all updates to batch at the end
        const personUpdates = []; // { person, newResidency }
        const villageUpdates = []; // { village }

        // Assign people to villages (in memory first)
        for (const tileIdStr of populatedTileIds) {
            const tileId = parseInt(tileIdStr);
            const villages = villagesByTile[tileId] || [];
            const people = peopleByTile[tileId] || [];

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

                for (const person of assignedPeople) {
                    // record old residency so we can remove from the old set when writing
                    const oldResidency = person.residency;
                    const newResidency = village.land_chunk_index;
                    person.residency = newResidency;
                    // _oldResidency is used only for pipeline update; delete later to avoid persisting it
                    person._oldResidency = oldResidency; // temporary marker for pipeline
                    personUpdates.push(person);
                    village.housing_slots.push(person.id);
                }

                villageUpdates.push(village);
                peopleIndex += toAssign;
            }
        }

        // Batch write all person updates
        if (personUpdates.length > 0) {
            const personPipeline = storage.pipeline();
            for (const person of personUpdates) {
                // If we recorded an old residency, remove person from that set first
                if (person.tile_id && person._oldResidency !== undefined && person._oldResidency !== null && person._oldResidency !== person.residency) {
                    personPipeline.srem(`village:${person.tile_id}:${person._oldResidency}:people`, person.id.toString());
                }
                // Write updated person
                personPipeline.hset('person', person.id.toString(), JSON.stringify(person));
                // Add to new residency set
            }
            await personPipeline.exec();
        }

        // Batch write all village updates
        if (villageUpdates.length > 0) {
            const villagePipeline = storage.pipeline();
            for (const village of villageUpdates) {
                villagePipeline.hset('village', village.id.toString(), JSON.stringify(village));
            }
            await villagePipeline.exec();
        }

        const serverConfig = require('../../config/server');
        if (serverConfig.verboseLogs) console.log(`[villageSeeder] Assigned residency to ${personUpdates.length} people in storage`);
    } catch (err) {
        console.error('[villageSeeder] Failed to assign residency in storage:', err);
    }
}

module.exports = {
    seedVillagesStorageFirst,
    assignResidencyStorage
};
