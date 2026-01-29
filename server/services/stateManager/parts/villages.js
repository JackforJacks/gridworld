const pool = require('../../../config/database');

async function insertPendingVillages(villageData, PopulationState) {
    const pendingVillageIds = await PopulationState.getPendingVillageInserts();
    let villagesInserted = 0;
    const villageIdMappings = [];

    if (pendingVillageIds.length > 0) {
        console.log(`🏗️ Inserting ${pendingVillageIds.length} pending villages into PostgreSQL...`);
        for (const tempId of pendingVillageIds) {
            try {
                const json = villageData[tempId.toString()];
                if (!json) continue;
                const v = JSON.parse(json);
                const insertResult = await pool.query(`
                    INSERT INTO villages (tile_id, land_chunk_index, name, housing_slots, housing_capacity, food_stores, food_capacity, food_production_rate)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                    RETURNING id
                `, [v.tile_id, v.land_chunk_index, v.name, JSON.stringify(v.housing_slots || []), v.housing_capacity || 1000, v.food_stores || 0, v.food_capacity || 100000, v.food_production_rate || 50]);

                const newId = insertResult.rows[0].id;
                villageIdMappings.push({ tempId: parseInt(tempId, 10), newId });

                try {
                    await pool.query(`UPDATE tiles_lands SET village_id = $1 WHERE tile_id = $2 AND chunk_index = $3`, [newId, v.tile_id, v.land_chunk_index]);
                } catch (e) { /* non-fatal */ }

                villagesInserted++;
            } catch (err) {
                console.warn('[stateManager] Failed to insert pending village:', err.message || err);
            }
        }

        if (villageIdMappings.length > 0) {
            await PopulationState.reassignVillageIds(villageIdMappings);
            console.log(`🏗️ Reassigned ${villageIdMappings.length} village IDs in storage`);
        }
        console.log(`🏗️ Inserted ${villagesInserted} villages into Postgres`);
    }

    return { villagesInserted, villageIdMappings };
}

module.exports = { insertPendingVillages };