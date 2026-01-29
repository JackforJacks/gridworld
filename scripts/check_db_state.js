const pool = require('../server/config/database');

async function check() {
    const tiles = await pool.query('SELECT COUNT(*) as c FROM tiles');
    console.log('Tiles count:', tiles.rows[0].c);
    
    const tl = await pool.query('SELECT COUNT(*) as c FROM tiles_lands');
    console.log('Tiles_lands count:', tl.rows[0].c);
    
    const cleared = await pool.query("SELECT COUNT(*) as c FROM tiles_lands WHERE land_type = 'cleared'");
    console.log('Cleared lands count:', cleared.rows[0].c);
    
    const habitable = await pool.query('SELECT COUNT(*) as c FROM tiles WHERE is_habitable = TRUE');
    console.log('Habitable tiles count:', habitable.rows[0].c);
    
    // Check for habitable tiles with cleared lands
    const habitableWithCleared = await pool.query(`
        SELECT DISTINCT t.id 
        FROM tiles t 
        INNER JOIN tiles_lands tl ON t.id = tl.tile_id AND tl.land_type = 'cleared'
        WHERE t.is_habitable = TRUE
    `);
    console.log('Habitable tiles with cleared lands:', habitableWithCleared.rows.length);
    
    await pool.end();
}

check().catch(console.error);
