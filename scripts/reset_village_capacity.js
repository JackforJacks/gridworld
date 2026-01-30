const pool = require('../server/config/database');

async function reset() {
    const capacity = parseInt(process.argv[2], 10);
    if (isNaN(capacity) || capacity <= 0) {
        console.error('Usage: node scripts/reset_village_capacity.js <capacity>');
        console.error('Example: node scripts/reset_village_capacity.js 100');
        process.exit(1);
    }

    await pool.query('BEGIN');
    try {
        const res = await pool.query(`UPDATE villages SET housing_capacity = $1 WHERE housing_capacity IS DISTINCT FROM $1 RETURNING id`, [capacity]);
        await pool.query('COMMIT');
        console.log(`Reset complete. Set housing_capacity to ${capacity}. Rows updated:`, res.rowCount);
        process.exit(0);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Reset failed:', err);
        process.exit(1);
    }
}

reset();
