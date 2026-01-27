const pool = require('./server/config/database');

(async () => {
    try {
        const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM people');
        console.log('Postgres people count:', rows[0].cnt);

        // Get sample of people with dates
        const { rows: sample } = await pool.query('SELECT id, date_of_birth FROM people LIMIT 5');
        console.log('Sample people:', sample);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
