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
