const pool = require('../server/config/database');

async function assignResidency(tileId = null) {
    await pool.query('BEGIN');
    try {
        let tilesToProcess;
        if (tileId) {
            tilesToProcess = [{ tile_id: tileId }];
        } else {
            // Get all tiles with villages
            const { rows } = await pool.query(`
                SELECT DISTINCT tile_id FROM villages
            `);
            tilesToProcess = rows;
        }

        for (const { tile_id } of tilesToProcess) {
            // Get villages for this tile
            const { rows: villages } = await pool.query(`
                SELECT id, housing_capacity, housing_slots
                FROM villages
                WHERE tile_id = $1
                ORDER BY id
            `, [tile_id]);

            // Get people on this tile without residency
            const { rows: unassignedPeople } = await pool.query(`
                SELECT id FROM people
                WHERE tile_id = $1 AND (residency IS NULL OR residency = 0)
                ORDER BY RANDOM()
            `, [tile_id]);

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
        }

        await pool.query('COMMIT');
        console.log('Residency assignment completed.');
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    }
}

assignResidency(process.argv[2] ? parseInt(process.argv[2]) : null).then(() => process.exit(0)).catch(console.error);