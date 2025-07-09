const pool = require('./server/config/database');

async function checkTilesTable() {
    try {
        // Check table structure
        const columns = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'tiles' 
            ORDER BY ordinal_position
        `);
        
        console.log('Tiles table columns:');
        columns.rows.forEach(r => {
            console.log(`  ${r.column_name}: ${r.data_type} (${r.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });
        
        // Check if there's any data
        const count = await pool.query('SELECT COUNT(*) FROM tiles');
        console.log(`\nTotal tiles in database: ${count.rows[0].count}`);
        
        // Check if biome column exists
        const hasBiome = columns.rows.some(r => r.column_name === 'biome');
        console.log(`\nHas biome column: ${hasBiome}`);
        
        if (hasBiome) {
            const biomeData = await pool.query('SELECT biome, COUNT(*) FROM tiles WHERE biome IS NOT NULL GROUP BY biome');
            console.log('\nBiome distribution in database:');
            biomeData.rows.forEach(r => {
                console.log(`  ${r.biome}: ${r.count}`);
            });
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        pool.end();
    }
}

checkTilesTable();
