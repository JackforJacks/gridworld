const pool = require('../server/config/database');

async function sync() {
    await pool.query('BEGIN');
    try {
        const res = await pool.query(`
      UPDATE tiles_lands tl
      SET village_id = v.id
      FROM villages v
      WHERE tl.tile_id = v.tile_id
        AND tl.chunk_index = v.land_chunk_index
        AND tl.village_id IS NULL
      RETURNING tl.tile_id, tl.chunk_index, v.id as village_id
    `);
        await pool.query('COMMIT');
        console.log('synced:', res.rowCount);
        process.exit(0);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('sync error', err);
        process.exit(1);
    }
}

sync();
