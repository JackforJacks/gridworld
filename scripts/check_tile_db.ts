const pool = require('../server/config/database');

(async () => {
    try {
        const tileId = parseInt(process.argv[2] || '475', 10);
        console.log('Checking tile', tileId);
        const peopleRes = await pool.query('SELECT COUNT(*) as cnt FROM people WHERE tile_id = $1', [tileId]);
        console.log('people_count_tile_' + tileId + ' =', peopleRes.rows[0].cnt);
        const famRes = await pool.query('SELECT COUNT(*) as famcnt FROM family WHERE tile_id = $1', [tileId]);
        console.log('family_count_tile_' + tileId + ' =', famRes.rows[0].famcnt);
        const sample = await pool.query('SELECT id, family_id, date_of_birth FROM people WHERE tile_id = $1 ORDER BY id DESC LIMIT 10', [tileId]);
        console.log('sample_last_10_people =', sample.rows);
    } catch (err) {
        console.error('Error checking tile DB:', err.message || err);
    } finally {
        await pool.end();
    }
})();