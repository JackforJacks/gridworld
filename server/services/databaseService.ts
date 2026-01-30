// Dynamic Database Service - Truncate all tables in the public schema
import pool from '../config/database';

class DatabaseService {
    // Truncate all tables in the public schema
    async truncateAllTables() {
        try {
            // Get all table names in the public schema
            const tablesQuery = `
                SELECT tablename 
                FROM pg_tables 
                WHERE schemaname = 'public' 
                AND tablename NOT IN ('pg_stat_statements')
                ORDER BY tablename;
            `;
            const { rows: tables } = await pool.query(tablesQuery);
            if (tables.length === 0) {
                return { message: 'No tables found to truncate' };
            }
            // Build a single TRUNCATE statement for all tables
            const tableNames = tables.map(t => `"${t.tablename}"`).join(', ');
            const truncateQuery = `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`;
            console.log(`🗑️ Truncating ${tables.length} tables: ${tableNames}`);
            await pool.query(truncateQuery);
            return {
                success: true,
                message: `Successfully truncated ${tables.length} tables`,
                tables: tables.map(t => t.tablename)
            };
        } catch (error: unknown) {
            console.error('Error truncating all tables:', error);
            throw error;
        }
    }
}

export default DatabaseService;
