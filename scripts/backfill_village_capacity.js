const pool = require('../server/config/database');

async function backfill() {
    await pool.query('BEGIN');
    try {
        const { rows } = await pool.query(`
      SELECT v.id, v.tile_id, COUNT(p.id)::int as tile_population
      FROM villages v
      LEFT JOIN people p ON p.tile_id = v.tile_id
      GROUP BY v.id, v.tile_id
    `);

        let updated = 0;
        const buffers = [200, 300, 400];
        for (const r of rows) {
            const buf = buffers[Math.floor(Math.random() * buffers.length)];
            const cap = Math.max(1, (r.tile_population || 0) + buf);
            await pool.query(`UPDATE villages SET housing_capacity = $1 WHERE id = $2`, [cap, r.id]);
            updated++;
        }

        await pool.query('COMMIT');
        console.log('Backfill complete. Updated villages:', updated);
        process.exit(0);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Backfill failed:', err);
        process.exit(1);
    }
}

backfill();
