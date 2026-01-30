/**
 * Village Seeder - Residency Assignment
 * Handles assigning people to villages
 */

import pool from '../../config/database';

/**
 * Assign residency for all unassigned people on a tile
 */
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
    } catch (err: unknown) {
        await pool.query('ROLLBACK');
        throw err;
    }
}

export {
    assignResidencyForTile
};
