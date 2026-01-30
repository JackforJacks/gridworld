const pool = require('../server/config/database');

async function main() {
  let client;
  try {
    client = await pool.connect();
    const res = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE residency IS NULL)::int AS null_residency,
             COUNT(*) FILTER (WHERE residency IS NOT NULL)::int AS with_residency
      FROM people
    `);
    console.log(res.rows[0]);
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
  }
}

main();
