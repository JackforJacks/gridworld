import pool from '../../../config/database';

async function processPeopleDeletes(PopulationState) {
    const pendingDeletes = await PopulationState.getPendingDeletes();

    if (pendingDeletes.length > 0) {
        console.log(`🗑️ Deleting ${pendingDeletes.length} people from PostgreSQL...`);
        const placeholders = pendingDeletes.map((_, idx) => `$${idx + 1}`).join(',');
        await pool.query(`DELETE FROM people WHERE id IN (${placeholders})`, pendingDeletes);
    }

    return pendingDeletes.length;
}

export { processPeopleDeletes };