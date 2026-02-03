import { Pool } from 'pg';

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gridworld',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function run() {
    const result = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    console.log('Tables:', result.rows.map(r => r.table_name));
    await pool.end();
}

run().catch(console.error);
