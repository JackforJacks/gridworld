const pool = require('../config/database');

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
    const min = 3;
    const max = 30;
    const requested = Number.isInteger(count) ? count : null;
    // Seed villages for each habitable tile: 3..30 villages per tile (or `count` per-tile if provided)
    const perTileMin = min;
    const perTileMax = max;
    const useFixedPerTile = Number.isInteger(count) && count > 0;

    await pool.query('BEGIN');
    try {
        // Get tiles that currently have people (only seed where population exists)
        const { rows: populatedTiles } = await pool.query(`
            SELECT DISTINCT tile_id FROM people WHERE tile_id IS NOT NULL
        `);
        if (!populatedTiles || populatedTiles.length === 0) {
            await pool.query('ROLLBACK');
            return { created: 0, villages: [] };
        }

        const inserted = [];

        for (const t of populatedTiles) {
            const tileId = t.tile_id;
            // Get current population on the tile
            const { rows: peopleCountRows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM people WHERE tile_id = $1`, [tileId]);
            const tilePopulation = (peopleCountRows && peopleCountRows[0]) ? Number(peopleCountRows[0].cnt) : 0;
            // Determine number of villages based on tile population.
            const housingCapacity = 1000;
            let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
            desiredVillages = Math.max(1, desiredVillages);
            desiredVillages = Math.min(perTileMax, desiredVillages);

            // Clear existing villages on this tile to ensure only the right amount
            await pool.query(`DELETE FROM villages WHERE tile_id = $1`, [tileId]);

            // Fetch available cleared chunks for this tile (now all should be available)
            const { rows: available } = await pool.query(`
                SELECT tl.chunk_index
                FROM tiles_lands tl
                LEFT JOIN villages v ON v.tile_id = tl.tile_id AND v.land_chunk_index = tl.chunk_index
                WHERE tl.tile_id = $1 AND tl.land_type = 'cleared' AND v.id IS NULL
                ORDER BY random()
                LIMIT $2
            `, [tileId, desiredVillages]);

            if (!available || available.length === 0) {
                continue; // nothing to place here
            }

            for (const r of available) {
                const name = `Village ${tileId}-${r.chunk_index}`;
                const housingSlots = JSON.stringify([]); // currently empty list of assigned family ids
                // Each village has fixed capacity 1000
                const housingCapacity = 1000;
                const { rows } = await pool.query(`
                    INSERT INTO villages (tile_id, land_chunk_index, name, housing_slots, housing_capacity)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *
                `, [tileId, r.chunk_index, name, housingSlots, housingCapacity]);
                const village = rows[0];
                inserted.push(village);
                try {
                    await pool.query(`
                        UPDATE tiles_lands SET village_id = $1
                        WHERE tile_id = $2 AND chunk_index = $3
                    `, [village.id, tileId, r.chunk_index]);
                } catch (e) {
                    // ignore if `village_id` column does not exist or update fails
                    console.warn('[villageSeeder] could not update tiles_lands.village_id - skipping:', e.message);
                }
            }
        }

        // Assign residency for all seeded tiles
        for (const t of populatedTiles) {
            await assignResidencyForTile(t.tile_id);
        }

        await pool.query('COMMIT');
        return { created: inserted.length, villages: inserted };
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

module.exports = { seedRandomVillages, seedIfNoVillages, assignResidencyForTile };

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

module.exports.seedVillagesForTile = seedVillagesForTile;

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

                // Create some initial people
                const initialPopulation = 50;
                // Batch insert and RETURNING to sync to Redis
                const values = [];
                const params = [];
                for (let i = 0; i < initialPopulation; i++) {
                    const pIndex = i * 3;
                    values.push(`($${pIndex + 1}, $${pIndex + 2}, $${pIndex + 3})`);
                    params.push(tileId, Math.random() > 0.5, '4000-01-01');
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

                console.log(`[villageSeeder] Created ${initialPopulation} initial people on tile ${tileId}`);
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
    seedIfNoVillages
};
