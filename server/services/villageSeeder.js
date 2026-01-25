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

module.exports = { seedRandomVillages, seedIfNoVillages };

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
            SELECT id, housing_capacity, housing_slots
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
            `, [village.id, assignedPeopleIds]);

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
