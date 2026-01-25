const pool = require('../server/config/database');

async function reset() {
    await pool.query('BEGIN');
    try {
        const res = await pool.query(`UPDATE villages SET housing_capacity = 100 WHERE housing_capacity IS DISTINCT FROM 100 RETURNING id`);
        await pool.query('COMMIT');
        console.log('Reset complete. Rows updated:', res.rowCount);
        process.exit(0);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Reset failed:', err);
        process.exit(1);
    }
}

reset();
