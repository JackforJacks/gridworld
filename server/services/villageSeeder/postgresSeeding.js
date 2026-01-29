/**
 * Village Seeder - Postgres-based Seeding
 * Handles village seeding using PostgreSQL as the source of truth
 */

const pool = require('../../config/database');
const { ensureVillageIdColumn } = require('./dbUtils');
const { assignResidencyForTile } = require('./residency');

/**
 * Seed random villages for all populated tiles in Postgres
 */
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
        const villageMap = [];

        for (const t of populatedTiles) {
            const tileId = t.tile_id;
            const tilePopulation = t.population;
            let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
            desiredVillages = Math.max(1, Math.min(perTileMax, desiredVillages));

            const availableChunks = chunksByTile[tileId] || [];
            const chunksToUse = availableChunks.slice(0, desiredVillages);

            for (const chunkIndex of chunksToUse) {
                const name = `Village ${tileId}-${chunkIndex}`;
                villageValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
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

        // Batch assign residency
        const { residencyUpdates, housingUpdates } = await buildResidencyUpdates(tileIds);

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
        const serverConfig = require('../../config/server');
        if (serverConfig.verboseLogs) console.log(`[villageSeeder] Created ${insertedCount} villages`);
        return { created: insertedCount, villages: [] };
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
}

/**
 * Build residency updates for batch assignment
 */
async function buildResidencyUpdates(tileIds) {
    // Get all villages grouped by tile
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

    // Build batch updates
    const residencyUpdates = [];
    const housingUpdates = [];

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

    return { residencyUpdates, housingUpdates };
}

/**
 * Seed villages for a specific tile in Postgres
 */
async function seedVillagesForTile(tileId) {
    await ensureVillageIdColumn();
    const perTileMin = 1;
    const perTileMax = 30;
    const housingCapacity = 1000;

    await pool.query('BEGIN');
    try {
        // Get tile population from Redis first, fallback to Postgres
        let tilePopulation = 0;
        try {
            const PopulationState = require('../populationState');
            const tilePops = await PopulationState.getAllTilePopulations();
            tilePopulation = tilePops[String(tileId)] || tilePops[tileId] || 0;
        } catch (e) {
            // Fallback to Postgres
            const { rows: popRows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM people WHERE tile_id = $1`, [tileId]);
            tilePopulation = (popRows && popRows[0]) ? Number(popRows[0].cnt) : 0;
        }

        if (tilePopulation === 0) {
            await pool.query('ROLLBACK');
            return { created: 0, villages: [] };
        }

        // Clear existing villages on this tile
        await pool.query(`DELETE FROM villages WHERE tile_id = $1`, [tileId]);

        // Number of villages needed
        let desiredVillages = Math.ceil(tilePopulation / housingCapacity);
        desiredVillages = Math.max(perTileMin, desiredVillages);
        desiredVillages = Math.min(perTileMax, desiredVillages);

        // Fetch available cleared chunks
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

module.exports = {
    seedRandomVillages,
    seedVillagesForTile,
    buildResidencyUpdates
};
