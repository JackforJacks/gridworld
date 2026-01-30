// Database Initialization Script
// Runs the consolidated database schema creation

import pool from '../config/database';
import fs from 'fs';
import path from 'path';

// __filename and __dirname are available in CommonJS

export async function initializeDatabase() {
    try {
        console.log('🔧 Initializing GridWorld database schema...');

        // Read the consolidated SQL file
        const sqlPath = path.join(__dirname, 'init_database.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // Execute the SQL
        await pool.query(sqlContent);

        console.log('✅ Database schema initialized successfully');
        console.log('📊 Tables created: tiles, people, family, calendar_state, schema_migrations');
        console.log('🔗 Foreign key relationships established');
        console.log('📈 Performance indexes created');

        // Verify tables exist
        const tablesQuery = `
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public' 
            ORDER BY tablename;
        `;
        const { rows: tables } = await pool.query(tablesQuery);
        console.log('📋 Tables in database:', tables.map(t => t.tablename).join(', '));

    } catch (error: unknown) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run if called directly (CommonJS check)
const isMainModule = require.main === module;
if (isMainModule) {
    (async () => {
        try {
            await initializeDatabase();
            console.log('🎉 Database initialization complete');
            process.exit(0);
        } catch (error: unknown) {
            console.error('💥 Initialization failed:', error);
            process.exit(1);
        }
    })();
}
