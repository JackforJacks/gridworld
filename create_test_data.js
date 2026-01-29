const pool = require('./server/config/database');

async function createTestData() {
  try {
    // Insert test villages
    await pool.query(`INSERT INTO villages (id, tile_id, land_chunk_index, name, food_stores, food_capacity, food_production_rate, housing_capacity)
                      VALUES (1, 100, 0, 'Test Village', 1000, 1000, 10, 100)`);
    await pool.query(`INSERT INTO villages (id, tile_id, land_chunk_index, name, food_stores, food_capacity, food_production_rate, housing_capacity)
                      VALUES (2, 100, 1, 'Test Village 2', 1000, 1000, 10, 100)`);

    // Insert test people
    for (let i = 1; i <= 100; i++) {
      await pool.query('INSERT INTO people (id, tile_id, residency, sex, date_of_birth) VALUES ($1, 100, $2, $3, \'3980-01-01\')',
                       [i, i % 2 + 1, i % 2 === 0]);
    }

    console.log('Test data created: 2 villages, 100 people');
  } catch (e) {
    console.error('Error creating test data:', e);
  } finally {
    pool.end();
  }
}

createTestData();