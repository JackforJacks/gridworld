const pool = require('../server/config/database');

async function checkSchema() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'villages' AND column_name = 'id'
        `);
        console.log('Villages ID column:', res.rows[0]);

        // Also check current sequence value
        const seq = await pool.query(`SELECT last_value FROM villages_id_seq`);
        console.log('Villages sequence last_value:', seq.rows[0].last_value);
    } catch (e) {
        console.error('Error:', e.message);
    }
    process.exit(0);
}

checkSchema();
