const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function runMigration() {
    const migrationPath = path.join(__dirname, '001_create_calendar_state.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    try {
        await pool.query(sql);
        console.log('Migration ran successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
