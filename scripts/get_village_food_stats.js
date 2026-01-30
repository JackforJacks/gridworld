const pool = require('../server/config/database');

async function main() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(`
      SELECT COUNT(*)::int AS total,
             AVG(food_production_rate)::float AS avg_rate,
             MIN(food_production_rate)::float AS min_rate,
             MAX(food_production_rate)::float AS max_rate
      FROM villages
    `);
    console.log(result.rows[0]);
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
  }
}

main();
