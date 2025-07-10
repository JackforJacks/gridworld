// tiles_lands initialization script
// This script initializes the tiles_lands table for all eligible tiles
// Usage: node server/migrations/init_tiles_lands.js

const pool = require('../config/database');

async function main() {
    // 1. Get all eligible tiles (not ocean, mountains, desert, tundra)
    const eligibleTiles = await pool.query(`
        SELECT id, biome, terrain_type
        FROM tiles
        WHERE terrain_type NOT IN ('ocean', 'mountains')
          AND (biome IS NULL OR biome NOT IN ('desert', 'tundra'))
    `);
    console.log(`Found ${eligibleTiles.rows.length} eligible tiles.`);

    for (const tile of eligibleTiles.rows) {
        // Insert cleared land type for each eligible tile
        for (let chunk_index = 0; chunk_index < 100; chunk_index++) {
            await pool.query(
                `INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [tile.id, chunk_index, 'cleared', true]
            );
        }
    }
    console.log('tiles_lands initialization complete.');
    await pool.end();
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
