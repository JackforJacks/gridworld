// Database Migration Runner
// Executes the init_database.sql migration file

const fs = require('fs');
const path = require('path');
const pool = require('./server/config/database');

async function runMigration() {
    try {
        console.log('🚀 Starting database migration...');

        // Read the SQL file
        const sqlPath = path.join(__dirname, 'server', 'migrations', 'init_database.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('📖 Read migration file successfully');

        // Execute the SQL
        await pool.query(sql);

        console.log('✅ Database migration completed successfully!');
        console.log('📊 All tables and indexes have been created/updated');

        // Verify tiles_lands table was created
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'tiles_lands' AND table_schema = 'public'
        `);

        if (result.rows.length > 0) {
            console.log('✅ tiles_lands table confirmed created');
        } else {
            console.log('❌ tiles_lands table not found');
        }

        // List all created tables
        const allTables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        console.log('📋 Database tables:', allTables.rows.map(row => row.table_name).join(', '));

        // Create villages table if it does not exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS villages (
                id SERIAL PRIMARY KEY,
                tile_id INTEGER NOT NULL REFERENCES tiles(id) ON DELETE CASCADE,
                land_chunk_index INTEGER NOT NULL CHECK (land_chunk_index >= 0 AND land_chunk_index < 100),
                name VARCHAR(100),
                housing_slots JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tile_id, land_chunk_index)
            )
        `);
        console.log('✅ villages table confirmed created or already exists');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error('Full error:', error);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

// Run the migration
runMigration();
