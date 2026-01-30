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
        console.error('[villageSeeder] storage not available - cannot seed villages');
        return { created: 0, villages: [] };
    }

    await ensureVillageIdColumn();
    const perTileMax = 30;
    const housingCapacity = 1000;

    // Check if villages already exist in Redis
    const existingVillages = await storage.hgetall('village');
    const villagesCount = existingVillages ? Object.keys(existingVillages).length : 0;
    if (villagesCount > 0) {
        console.log(`[villageSeeder] Redis already has ${villagesCount} villages, skipping storage-first seeding`);
        return { created: 0, villages: [] };
    }

    try {
        const PopulationState = require('../populationState');

        // Get population counts per tile from Redis
        let tilePopulations = await PopulationState.getAllTilePopulations();
        let populatedTileIds = Object.keys(tilePopulations).filter(id => tilePopulations[id] > 0);

        // If no per-village sets found, try a best-effort fallback: group people by tile_id
        if (populatedTileIds.length === 0) {
            console.log('[villageSeeder] No populated tiles found via sets; falling back to grouping people by tile_id');
            let allPeople = await PopulationState.getAllPeople();
            console.log('[villageSeeder] getAllPeople returned:', allPeople.length, 'people');
            const byTile = {};
            if (!allPeople || allPeople.length === 0) {
                // Last-resort: read raw person hash directly from storage
                console.log('[villageSeeder] Trying raw storage.hgetall(person)...');
                try {
                    const peopleRaw = await storage.hgetall('person') || {};
                    console.log('[villageSeeder] Raw person hash has', Object.keys(peopleRaw).length, 'entries');
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

        // Set tile fertility in storage (get from Redis tile data)
        for (const tileId of populatedTileIds) {
            const tileJson = await storage.hget('tile', tileId.toString());
            if (tileJson) {
                const tile = JSON.parse(tileJson);
                if (tile.fertility !== null) {
                    await storage.hset('tile:fertility', tileId.toString(), tile.fertility.toString());
                }
            }
        }

        // Clear existing villages in storage
        await storage.del('village');

        // Get cleared chunks from Redis (only source of truth)
        const landsData = await storage.hgetall('tile:lands');
        const chunksByTile = {};
        for (const tileIdStr of populatedTileIds) {
            const tileId = parseInt(tileIdStr);
            const landsJson = landsData ? landsData[tileIdStr] : null;
            if (landsJson) {
                const lands = JSON.parse(landsJson);
                const clearedChunks = lands
                    .filter(land => land.land_type === 'cleared')
                    .map(land => land.chunk_index);
                // Shuffle cleared chunks for randomness
                for (let i = clearedChunks.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [clearedChunks[i], clearedChunks[j]] = [clearedChunks[j], clearedChunks[i]];
                }
                chunksByTile[tileId] = clearedChunks;
            }
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
                // Clean up temporary marker before saving
                const personToSave = { ...person };
                delete personToSave._oldResidency;
                // Write updated person
                personPipeline.hset('person', person.id.toString(), JSON.stringify(personToSave));
                // Add to new residency set
                if (person.tile_id && person.residency !== null && person.residency !== undefined) {
                    personPipeline.sadd(`village:${person.tile_id}:${person.residency}:people`, person.id.toString());
                }
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

/**
 * Seed a new world if Redis is empty (Redis-first approach)
 * Called after loading from Postgres - if nothing was loaded, create fresh world
 * @returns {Promise<Object>} Result with seeded counts
 */
async function seedWorldIfEmpty() {
    if (!storage.isAvailable()) {
        console.warn('[villageSeeder] Storage not available, cannot seed world');
        return { seeded: false, people: 0, villages: 0 };
    }

    const PopulationState = require('../populationState');

    // Check if Redis already has people
    const existingPeople = await PopulationState.getTotalPopulation();
    if (existingPeople > 0) {
        console.log(`[villageSeeder] Redis already has ${existingPeople} people, skipping world seeding`);
        return { seeded: false, people: existingPeople, villages: 0 };
    }

    console.log('[villageSeeder] 🌍 Redis is empty, seeding new world...');

    // Create initial tiles in Redis (and Postgres for persistence)
    const tilesToPopulate = await createInitialTilesRedisFirst();

    // Create initial population on each tile
    let totalPeople = 0;
    for (const tile of tilesToPopulate) {
        const peopleCreated = await createInitialPopulationRedisFirst(tile.id);
        totalPeople += peopleCreated;
    }

    console.log(`[villageSeeder] Created ${totalPeople} people on ${tilesToPopulate.length} tiles`);

    // Now seed villages for these populated tiles
    const villageResult = await seedVillagesStorageFirst();

    // Assign residency to people
    await assignResidencyStorage();

    console.log(`[villageSeeder] 🌍 World seeding complete: ${totalPeople} people, ${villageResult.created} villages`);

    return {
        seeded: true,
        people: totalPeople,
        villages: villageResult.created,
        tiles: tilesToPopulate.length
    };
}

/**
 * Create initial tiles in Redis (and sync to Postgres)
 * @returns {Promise<Array>} Array of created tile objects
 */
async function createInitialTilesRedisFirst() {
    const initialTiles = [
        { id: 1, center_x: 0, center_y: 0, center_z: 1, latitude: 90, longitude: 0, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 75 },
        { id: 2, center_x: 1, center_y: 0, center_z: 0, latitude: 0, longitude: 90, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 70 },
        { id: 3, center_x: 0, center_y: 1, center_z: 0, latitude: 0, longitude: 0, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 80 },
        { id: 4, center_x: -1, center_y: 0, center_z: 0, latitude: 0, longitude: 180, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 65 },
        { id: 5, center_x: 0, center_y: -1, center_z: 0, latitude: 0, longitude: 270, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 72 }
    ];

    const pipeline = storage.pipeline();

    for (const tile of initialTiles) {
        const tileData = {
            ...tile,
            biome: 'temperate_grassland',
            boundary_points: [],
            neighbor_ids: []
        };

        // Store tile in Redis
        pipeline.hset('tile', tile.id.toString(), JSON.stringify(tileData));

        // Create tile lands (100 chunks per tile, first 5 cleared for villages)
        const landsForTile = [];
        for (let chunkIndex = 0; chunkIndex < 100; chunkIndex++) {
            const landType = chunkIndex < 5 ? 'cleared' : (Math.random() > 0.3 ? 'forest' : 'wasteland');
            landsForTile.push({
                tile_id: tile.id,
                chunk_index: chunkIndex,
                land_type: landType,
                cleared: landType === 'cleared'
            });
        }
        pipeline.hset('tile:lands', tile.id.toString(), JSON.stringify(landsForTile));

        // Also persist to Postgres for durability
        try {
            await pool.query(`
                INSERT INTO tiles (id, center_x, center_y, center_z, latitude, longitude, terrain_type, is_land, is_habitable, fertility, biome, boundary_points, neighbor_ids)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO NOTHING
            `, [tile.id, tile.center_x, tile.center_y, tile.center_z, tile.latitude, tile.longitude, tile.terrain_type, tile.is_land, tile.is_habitable, tile.fertility, 'temperate_grassland', '[]', '[]']);

            for (let chunkIndex = 0; chunkIndex < 100; chunkIndex++) {
                const landType = chunkIndex < 5 ? 'cleared' : (Math.random() > 0.3 ? 'forest' : 'wasteland');
                await pool.query(`
                    INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (tile_id, chunk_index) DO NOTHING
                `, [tile.id, chunkIndex, landType, landType === 'cleared']);
            }
        } catch (err) {
            console.warn(`[villageSeeder] Could not persist tile ${tile.id} to Postgres:`, err.message);
        }
    }

    await pipeline.exec();
    console.log(`[villageSeeder] Created ${initialTiles.length} initial tiles in Redis`);

    return initialTiles;
}

/**
 * Create initial population on a tile (Redis-first)
 * @param {number} tileId - The tile ID to populate
 * @returns {Promise<number>} Number of people created
 */
async function createInitialPopulationRedisFirst(tileId) {
    const PopulationState = require('../populationState');
    const { getRandomSex, getRandomAge, getRandomBirthDate } = require('../population/calculator.js');

    // Add 100-200 people per tile
    const peopleCount = 100 + Math.floor(Math.random() * 100);
    const people = [];

    for (let i = 0; i < peopleCount; i++) {
        const sex = getRandomSex();
        const age = getRandomAge();
        const birthDate = getRandomBirthDate(1, 1, 1, age);
        const tempId = await PopulationState.getNextId();

        people.push({
            id: tempId,
            tile_id: tileId,
            residency: 0,
            sex: sex,
            date_of_birth: birthDate,
            health: 100,
            family_id: null
        });
    }

    // Batch add all people
    await PopulationState.batchAddPersons(people, true);

    return peopleCount;
}

module.exports = {
    seedVillagesStorageFirst,
    assignResidencyStorage,
    seedWorldIfEmpty
};
