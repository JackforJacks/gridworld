const pool = require('./server/config/database');

(async () => {
    try {
        await pool.query("INSERT INTO people (tile_id, sex, date_of_birth) VALUES (1, true, '4000-01-01')");
        console.log('Inserted person successfully');
        const count = await pool.query('SELECT COUNT(*) as count FROM people WHERE tile_id = 1');
        console.log('People count:', count.rows[0]);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
})();