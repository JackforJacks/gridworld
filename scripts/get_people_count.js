const pool = require('../server/config/database');

async function main() {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query('SELECT COUNT(*)::int AS count FROM people');
    console.log(`people count: ${res.rows[0].count}`);
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
  }
}

main();
