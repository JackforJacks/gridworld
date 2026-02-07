// Direct database query only
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gridworld',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

(async () => {
    // Check specific tiles that were selected for population
    const tileIds = [818, 1329, 30, 574, 894];
    const { rows: tilesWithLands } = await pool.query(
        "SELECT tile_id, COUNT(*) as chunks, SUM(CASE WHEN land_type = 'cleared' THEN 1 ELSE 0 END) as cleared_count FROM tiles_lands WHERE tile_id = ANY($1) GROUP BY tile_id",
        [tileIds]
    );
    console.log('Tiles selected for population and their lands:', tilesWithLands);

    // Check how many habitable tiles have cleared lands
    const { rows: habitableWithLands } = await pool.query(`
    SELECT COUNT(DISTINCT t.id) as cnt 
    FROM tiles t 
    INNER JOIN tiles_lands tl ON t.id = tl.tile_id AND tl.land_type = 'cleared'
    WHERE t.terrain_type NOT IN ('ocean', 'mountains') AND (t.biome IS NULL OR t.biome NOT IN ('desert', 'tundra', 'alpine'))
  `);
    console.log('Habitable tiles with cleared lands:', habitableWithLands[0].cnt);

    // Get a sample of these tiles
    const { rows: sample } = await pool.query(`
    SELECT DISTINCT t.id 
    FROM tiles t 
    INNER JOIN tiles_lands tl ON t.id = tl.tile_id AND tl.land_type = 'cleared'
    WHERE t.terrain_type NOT IN ('ocean', 'mountains') AND (t.biome IS NULL OR t.biome NOT IN ('desert', 'tundra', 'alpine'))
    LIMIT 10
  `);
    console.log('Sample habitable tiles with cleared lands:', sample.map(r => r.id));

    await pool.end();
    process.exit(0);
})();
