const pool = require('./server/config/database');

async function addPeople() {
    try {
        for (let i = 1; i <= 100; i++) {
            await pool.query('INSERT INTO people (tile_id, residency, sex, date_of_birth) VALUES (974, $1, $2, \'3980-01-01\')',
                [i % 2 + 1, i % 2 === 0]);
        }
        console.log('Added 100 people');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        pool.end();
    }
}

addPeople();