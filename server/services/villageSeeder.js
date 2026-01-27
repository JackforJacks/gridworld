const pool = require('../config/database');
const redis = require('../config/redis');
const { isRedisAvailable } = require('../config/redis');

// Ensure tiles_lands has village_id column (older DBs may miss this column)
let ensureVillageIdColumnPromise = null;
async function ensureVillageIdColumn() {
    if (!ensureVillageIdColumnPromise) {
        ensureVillageIdColumnPromise = (async () => {
            try {
                await pool.query(`ALTER TABLE tiles_lands ADD COLUMN IF NOT EXISTS village_id INTEGER REFERENCES villages(id) ON DELETE SET NULL`);
                await pool.query(`CREATE INDEX IF NOT EXISTS idx_tiles_lands_village_id ON tiles_lands(village_id)`);
                console.log('[villageSeeder] Ensured tiles_lands.village_id column exists');
            } catch (e) {
                console.warn('[villageSeeder] Failed to ensure tiles_lands.village_id column:', e.message);
            }
        })();
    }
    return ensureVillageIdColumnPromise;
}

async function seedRandomVillages(count = null) {
    await ensureVillageIdColumn();
    const perTileMax = 30;
    const housingCapacity = 1000;

    await pool.query('BEGIN');
    try {
        // Get tiles with population count in a single query
        const { rows: populatedTiles } = await pool.query(`
            SELECT tile_id, COUNT(*)::int AS population
            FROM people 
            WHERE tile_id IS NOT NULL
            GROUP BY tile_id
        `);
        
        if (!populatedTiles || populatedTiles.length === 0) {
            await pool.query('ROLLBACK');
            return { created: 0, villages: [] };
        }

        // Delete all existing villages for populated tiles at once
        const tileIds = populatedTiles.map(t => t.tile_id);
        await pool.query(`DELETE FROM villages WHERE tile_id = ANY($1)`, [tileIds]);

        // Get all available cleared chunks for all tiles at once
        const { rows: allChunks } = await pool.query(`
            SELECT tl.tile_id, tl.chunk_index
            FROM tiles_lands tl
            WHERE tl.tile_id = ANY($1) AND tl.land_type = 'cleared'
            ORDER BY tl.tile_id, RANDOM()
        `, [tileIds]);

        // Group chunks by tile_id
        const chunksByTile = {};
        for (const chunk of allChunks) {
            if (!chunksByTile[chunk.tile_id]) chunksByTile[chunk.tile_id] = [];
            chunksByTile[chunk.tile_id].push(chunk.chunk_index);
        }

        // Build batch insert for villages
        const villageValues = [];
        const villageParams = [];
        let paramIndex = 1;
        const villageMap = []; // Track tile_id and chunk_index for each village

        for (const t of populatedTiles) {
            const tileId = t.tile_id;
            const tilePopulation = t.population;
            let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
            desiredVillages = Math.max(1, Math.min(perTileMax, desiredVillages));

            const availableChunks = chunksByTile[tileId] || [];
            const chunksToUse = availableChunks.slice(0, desiredVillages);

            for (const chunkIndex of chunksToUse) {
                const name = `Village ${tileId}-${chunkIndex}`;
                villageValues.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4})`);
                villageParams.push(tileId, chunkIndex, name, JSON.stringify([]), housingCapacity);
                villageMap.push({ tile_id: tileId, chunk_index: chunkIndex });
                paramIndex += 5;
            }
        }

        let insertedCount = 0;
        if (villageValues.length > 0) {
            // Batch insert all villages
            const { rows: insertedVillages } = await pool.query(`
                INSERT INTO villages (tile_id, land_chunk_index, name, housing_slots, housing_capacity)
                VALUES ${villageValues.join(', ')}
                RETURNING id, tile_id, land_chunk_index
            `, villageParams);
            insertedCount = insertedVillages.length;

            // Batch update tiles_lands with village_ids
            if (insertedVillages.length > 0) {
                const updateCases = insertedVillages.map(v => 
                    `WHEN tile_id = ${v.tile_id} AND chunk_index = ${v.land_chunk_index} THEN ${v.id}`
                ).join(' ');
                const wherePairs = insertedVillages.map(v => 
                    `(tile_id = ${v.tile_id} AND chunk_index = ${v.land_chunk_index})`
                ).join(' OR ');
                
                try {
                    await pool.query(`
                        UPDATE tiles_lands SET village_id = CASE ${updateCases} END
                        WHERE ${wherePairs}
                    `);
                } catch (e) {
                    console.warn('[villageSeeder] could not batch update tiles_lands.village_id:', e.message);
                }
            }
        }

        // Batch assign residency - get all villages grouped by tile
        const { rows: allVillages } = await pool.query(`
            SELECT id, tile_id, land_chunk_index, housing_slots, housing_capacity
            FROM villages WHERE tile_id = ANY($1)
            ORDER BY tile_id, id
        `, [tileIds]);

        // Get all unassigned people in a single query
        const { rows: unassignedPeople } = await pool.query(`
            SELECT id, tile_id FROM people
            WHERE tile_id = ANY($1) AND (residency IS NULL OR residency = 0)
            ORDER BY tile_id, RANDOM()
        `, [tileIds]);

        // Group people by tile
        const peopleByTile = {};
        for (const person of unassignedPeople) {
            if (!peopleByTile[person.tile_id]) peopleByTile[person.tile_id] = [];
            peopleByTile[person.tile_id].push(person.id);
        }

        // Group villages by tile
        const villagesByTile = {};
        for (const v of allVillages) {
            if (!villagesByTile[v.tile_id]) villagesByTile[v.tile_id] = [];
            villagesByTile[v.tile_id].push(v);
        }

        // Build batch updates for residency and housing_slots
        const residencyUpdates = []; // { residency, personIds }
        const housingUpdates = [];   // { villageId, slots }

        for (const tileId of tileIds) {
            const villages = villagesByTile[tileId] || [];
            const people = peopleByTile[tileId] || [];
            let peopleIndex = 0;

            for (const village of villages) {
                const currentSlots = village.housing_slots || [];
                const available = village.housing_capacity - currentSlots.length;
                if (available <= 0 || peopleIndex >= people.length) continue;

                const toAssign = Math.min(available, people.length - peopleIndex);
                const assignedIds = people.slice(peopleIndex, peopleIndex + toAssign);

                residencyUpdates.push({ residency: village.land_chunk_index, personIds: assignedIds });
                housingUpdates.push({ villageId: village.id, slots: [...currentSlots, ...assignedIds] });

                peopleIndex += toAssign;
            }
        }

        // Execute residency updates in batches
        for (const update of residencyUpdates) {
            await pool.query(`UPDATE people SET residency = $1 WHERE id = ANY($2)`, 
                [update.residency, update.personIds]);
        }

        // Execute housing_slots updates in batches
        for (const update of housingUpdates) {
            await pool.query(`UPDATE villages SET housing_slots = $1 WHERE id = $2`,
                [JSON.stringify(update.slots), update.villageId]);
        }

        await pool.query('COMMIT');
        console.log(`[villageSeeder] Created ${insertedCount} villages, assigned residency for ${unassignedPeople.length} people`);
        return { created: insertedCount, villages: [] };
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
}

async function seedIfNoVillages() {
    const { rows } = await pool.query('SELECT COUNT(*)::int as cnt FROM villages');
    const cnt = rows && rows[0] ? rows[0].cnt : 0;
    if (cnt === 0) {
        return seedRandomVillages();
    }
    return { created: 0, villages: [] };
}

// Note: module.exports is at the end of the file

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
        const PopulationState = require('./populationState');
        const StateManager = require('./stateManager');

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

        // Get cleared chunks from Postgres (tiles_lands stays in Postgres)
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
        // Use the PopulationState temp ID generator to get unique negative IDs

        for (const tileIdStr of populatedTileIds) {
            const tileId = parseInt(tileIdStr);
            const tilePopulation = tilePopulations[tileIdStr];
            let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
            desiredVillages = Math.max(1, Math.min(perTileMax, desiredVillages));

            const availableChunks = chunksByTile[tileId] || [];
            const chunksToUse = availableChunks.slice(0, desiredVillages);

            for (const chunkIndex of chunksToUse) {
                // Acquire a temporary negative ID for the village
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
        const PopulationState = require('./populationState');

        // Group villages by tile
        const villagesByTile = {};
        for (const v of allVillages) {
            if (!villagesByTile[v.tile_id]) villagesByTile[v.tile_id] = [];
            villagesByTile[v.tile_id].push(v);
        }

        // Get all people from Redis
        const allPeople = await PopulationState.getAllPeople();

        // Group people by tile (include those with existing residency so we can reset and reassign)
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

            // First, clear existing residency for all people on this tile to avoid stale assignments
            const clearPipeline = redis.pipeline();
            for (const p of people) {
                if (p.residency !== null && p.residency !== undefined) {
                    clearPipeline.srem(`village:${p.tile_id}:${p.residency}:people`, p.id.toString());
                    // Update person residency to null
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

                // Update people with residency in Redis and maintain village membership sets
                const personWritePipeline = redis.pipeline();
                for (const person of assignedPeople) {
                    const pid = person.id;

                    // Update residency on person
                    await PopulationState.updatePerson(pid, { residency: village.land_chunk_index });

                    // Add to new village set
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

async function seedVillagesForTile(tileId) {
    await ensureVillageIdColumn();
    const perTileMin = 1;
    const perTileMax = 30;
    const housingCapacity = 1000;
    await pool.query('BEGIN');
    try {
        // Get tile population
        const { rows: popRows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM people WHERE tile_id = $1`, [tileId]);
        const tilePopulation = (popRows && popRows[0]) ? Number(popRows[0].cnt) : 0;

        if (tilePopulation === 0) {
            await pool.query('ROLLBACK');
            return { created: 0, villages: [] };
        }

        // Clear existing villages on this tile to ensure only the right amount
        await pool.query(`DELETE FROM villages WHERE tile_id = $1`, [tileId]);

        // number of villages needed (each village has fixed capacity)
        let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
        desiredVillages = Math.max(perTileMin, desiredVillages);
        desiredVillages = Math.min(perTileMax, desiredVillages);

        // fetch available cleared chunks (now all should be available)
        const { rows: available } = await pool.query(`
            SELECT tl.chunk_index
            FROM tiles_lands tl
            LEFT JOIN villages v ON v.tile_id = tl.tile_id AND v.land_chunk_index = tl.chunk_index
            WHERE tl.tile_id = $1 AND tl.land_type = 'cleared' AND v.id IS NULL
            ORDER BY random()
            LIMIT $2
        `, [tileId, desiredVillages]);

        if (!available || available.length === 0) {
            await pool.query('ROLLBACK');
            return { created: 0, villages: [] };
        }

        const inserted = [];
        for (const r of available) {
            const name = `Village ${tileId}-${r.chunk_index}`;
            const housingSlots = JSON.stringify([]);
            const { rows } = await pool.query(`
                INSERT INTO villages (tile_id, land_chunk_index, name, housing_slots, housing_capacity)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `, [tileId, r.chunk_index, name, housingSlots, housingCapacity]);
            const village = rows[0];
            inserted.push(village);
            try {
                await pool.query(`UPDATE tiles_lands SET village_id = $1 WHERE tile_id = $2 AND chunk_index = $3`, [village.id, tileId, r.chunk_index]);
            } catch (e) {
                console.warn('[villageSeeder] could not update tiles_lands.village_id - skipping:', e.message);
            }
        }

        await pool.query('COMMIT');

        // Assign residency after seeding
        await assignResidencyForTile(tileId);

        return { created: inserted.length, villages: inserted };
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
}

// seedVillagesForTile is exported at the end of the file

async function assignResidencyForTile(tileId) {
    await pool.query('BEGIN');
    try {
        // Get villages for this tile
        const { rows: villages } = await pool.query(`
            SELECT id, land_chunk_index, housing_capacity, housing_slots
            FROM villages
            WHERE tile_id = $1
            ORDER BY id
        `, [tileId]);

        // Get people on this tile without residency
        const { rows: unassignedPeople } = await pool.query(`
            SELECT id FROM people
            WHERE tile_id = $1 AND (residency IS NULL OR residency = 0)
            ORDER BY RANDOM()
        `, [tileId]);

        let peopleIndex = 0;

        for (const village of villages) {
            const currentOccupied = village.housing_slots.length;
            const available = village.housing_capacity - currentOccupied;

            if (available <= 0 || peopleIndex >= unassignedPeople.length) continue;

            const toAssign = Math.min(available, unassignedPeople.length - peopleIndex);
            const assignedPeopleIds = unassignedPeople.slice(peopleIndex, peopleIndex + toAssign).map(p => p.id);

            // Update people residency
            await pool.query(`
                UPDATE people SET residency = $1 WHERE id = ANY($2)
            `, [village.land_chunk_index, assignedPeopleIds]);

            // Update village housing_slots
            const updatedSlots = [...village.housing_slots, ...assignedPeopleIds];
            await pool.query(`
                UPDATE villages SET housing_slots = $1 WHERE id = $2
            `, [JSON.stringify(updatedSlots), village.id]);

            peopleIndex += toAssign;
        }

        await pool.query('COMMIT');
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
}

/**
 * Seed villages if none exist in the database
 * @returns {Promise<Object>} Result with created count and villages
 */
async function seedIfNoVillages() {
    try {
        // Check if any villages exist
        const { rows: existingVillages } = await pool.query('SELECT COUNT(*) as count FROM villages');
        const villageCount = parseInt(existingVillages[0].count);

        if (villageCount > 0) {
            console.log(`[villageSeeder] ${villageCount} villages already exist, skipping seeding`);
            return { created: 0, villages: [] };
        }

        console.log('[villageSeeder] No villages found, seeding initial villages...');

        // Check if there are any populated tiles
        const { rows: populatedTiles } = await pool.query(`
            SELECT DISTINCT tile_id FROM people WHERE tile_id IS NOT NULL
        `);

        if (!populatedTiles || populatedTiles.length === 0) {
            console.log('[villageSeeder] No populated tiles found, creating initial population and villages...');

            // Check if there are any tiles at all
            const { rows: allTiles } = await pool.query('SELECT COUNT(*) as count FROM tiles');
            const tileCount = parseInt(allTiles[0].count);

            if (tileCount === 0) {
                console.log('[villageSeeder] No tiles found, creating initial habitable tiles...');

                // Create some initial habitable tiles
                const initialTiles = [
                    { id: 1, center_x: 0, center_y: 0, center_z: 1, latitude: 90, longitude: 0, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 75 },
                    { id: 2, center_x: 1, center_y: 0, center_z: 0, latitude: 0, longitude: 90, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 70 },
                    { id: 3, center_x: 0, center_y: 1, center_z: 0, latitude: 0, longitude: 0, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 80 },
                    { id: 4, center_x: -1, center_y: 0, center_z: 0, latitude: 0, longitude: 180, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 65 },
                    { id: 5, center_x: 0, center_y: -1, center_z: 0, latitude: 0, longitude: 270, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 72 }
                ];

                for (const tile of initialTiles) {
                    await pool.query(`
                        INSERT INTO tiles (id, center_x, center_y, center_z, latitude, longitude, terrain_type, is_land, is_habitable, fertility, biome, boundary_points, neighbor_ids)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                        ON CONFLICT (id) DO NOTHING
                    `, [tile.id, tile.center_x, tile.center_y, tile.center_z, tile.latitude, tile.longitude, tile.terrain_type, tile.is_land, tile.is_habitable, tile.fertility, 'temperate_grassland', '[]', '[]']);

                    // Create tiles_lands for this tile (100 chunks, mostly forest, some cleared for villages)
                    for (let chunkIndex = 0; chunkIndex < 100; chunkIndex++) {
                        // Clear the first few chunks for villages
                        const landType = chunkIndex < 5 ? 'cleared' : (Math.random() > 0.3 ? 'forest' : 'wasteland');
                        await pool.query(`
                            INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared)
                            VALUES ($1, $2, $3, $4)
                            ON CONFLICT (tile_id, chunk_index) DO NOTHING
                        `, [tile.id, chunkIndex, landType, landType === 'cleared']);
                    }
                }

                console.log(`[villageSeeder] Created ${initialTiles.length} initial habitable tiles with land chunks`);
            }

            // Create initial population on a random habitable tile
            const { rows: habitableTiles } = await pool.query(`
                SELECT id FROM tiles
                WHERE biome NOT IN ('desert', 'tundra', 'alpine')
                AND terrain_type NOT IN ('ocean', 'mountains')
                ORDER BY RANDOM()
                LIMIT 1
            `);

            if (habitableTiles.length > 0) {
                const tileId = habitableTiles[0].id;
                console.log(`[villageSeeder] Creating initial population on tile ${tileId}`);

                // Create initial people - enough for a viable starting population
                // This is a fallback that should rarely trigger
                console.warn('⚠️ [villageSeeder] Creating fallback initial population - this should only happen on first run!');
                const initialPopulation = 2500;
                // Batch insert and RETURNING to sync to Redis
                const values = [];
                const params = [];
                for (let i = 0; i < initialPopulation; i++) {
                    const pIndex = i * 3;
                    values.push(`($${pIndex + 1}, $${pIndex + 2}, $${pIndex + 3})`);
                    // Create people born 16-50 years ago so they're adults
                    const age = 16 + Math.floor(Math.random() * 35);
                    const birthYear = 4000 - age;
                    const birthMonth = 1 + Math.floor(Math.random() * 12);
                    const birthDay = 1 + Math.floor(Math.random() * 8);
                    const birthDate = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
                    params.push(tileId, Math.random() > 0.5, birthDate);
                }
                if (values.length > 0) {
                    const res = await pool.query(`INSERT INTO people (tile_id, sex, date_of_birth) VALUES ${values.join(',')} RETURNING id, tile_id, residency, sex, date_of_birth`, params);
                    try {
                        const PopulationState = require('./populationState');
                        for (const row of res.rows) {
                            const personObj = { id: row.id, tile_id: row.tile_id, residency: row.residency, sex: row.sex, health: 100 };
                            await PopulationState.addPerson(personObj);
                        }
                    } catch (err) {
                        console.warn('⚠️ Could not sync seeded people to Redis (PopulationState):', err.message);
                    }
                }

                console.log(`[villageSeeder] Created ${initialPopulation} initial people on tile ${tileId} (adults aged 16-50)`);
            }
        }

        // Now seed villages
        const result = await seedRandomVillages(5); // Seed 5 villages per populated tile

        console.log(`[villageSeeder] Seeded ${result.created} initial villages`);
        return result;

    } catch (error) {
        console.error('[villageSeeder] Error seeding villages if none exist:', error);
        throw error;
    }
}

module.exports = {
    seedRandomVillages,
    seedIfNoVillages,
    assignResidencyForTile,
    seedVillagesRedisFirst,
    seedVillagesForTile
};
