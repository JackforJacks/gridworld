// Run migration to create rust_simulation_state table
// Use pg directly with environment variables

const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'gridworld',
});

async function createTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rust_simulation_state (
                id INT PRIMARY KEY DEFAULT 1,
                state_json TEXT NOT NULL,
                population INT NOT NULL DEFAULT 0,
                calendar_year INT NOT NULL DEFAULT 4000,
                last_updated TIMESTAMP DEFAULT NOW(),
                CONSTRAINT single_rust_state CHECK (id = 1)
            )
        `);
        console.log('✅ rust_simulation_state table created');
        await pool.end();
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        await pool.end();
        process.exit(1);
    }
}

createTable();
