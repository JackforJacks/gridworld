// Truncate all tables to force fresh regeneration
require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gridworld',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
});

async function truncateAll() {
    try {
        console.log('Truncating all tables...');
        
        // Truncate tables if they exist
        const tables = ['families', 'people', 'villages', 'tiles_lands', 'tiles'];
        for (const table of tables) {
            try {
                await pool.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
                console.log(`${table} truncated`);
            } catch (e) {
                if (e.code === '42P01') {
                    console.log(`${table} does not exist yet, skipping`);
                } else {
                    throw e;
                }
            }
        }
        
        const result = await pool.query('SELECT COUNT(*) as count FROM tiles');
        console.log('Tiles count after truncate:', result.rows[0].count);
        
        console.log('\nAll tables truncated successfully!');
        console.log('Now start the server to regenerate tiles with HEXASPHERE_SUBDIVISIONS=12');
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

truncateAll();
