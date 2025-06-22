const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function runMigrations() {
    const client = await pool.connect();
    try {
        // 1. Create migrations table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY
            );
        `);

        // 2. Get already run migrations
        const ranMigrationsResult = await client.query('SELECT version FROM schema_migrations');
        const ranMigrations = ranMigrationsResult.rows.map(row => row.version);

        // 3. Get all migration files
        const migrationsDir = __dirname;
        const allMigrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort(); // Sort to ensure order

        // 4. Determine and run new migrations
        for (const file of allMigrationFiles) {
            if (!ranMigrations.includes(file)) {
                console.log(`Running migration: ${file}...`);
                const migrationPath = path.join(migrationsDir, file);
                const sql = fs.readFileSync(migrationPath, 'utf8');

                // Run migration within a transaction
                try {
                    await client.query('BEGIN');
                    await client.query(sql);
                    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
                    await client.query('COMMIT');
                    console.log(`Successfully ran and recorded migration: ${file}`);
                } catch (err) {
                    await client.query('ROLLBACK');
                    // If error is column/table already exists, log and skip
                    if (err.code === '42701' || err.code === '42P07') {
                        console.warn(`Migration ${file} skipped: already applied (${err.code})`);
                        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
                        continue;
                    } else {
                        console.error(`Failed to run migration ${file}:`, err);
                        throw err; // Stop on first serious error
                    }
                }
            }
        }

        console.log('All new migrations have been run successfully!');

    } catch (err) {
        console.error('Migration process failed:', err);
    } finally {
        client.release();
    }
}

runMigrations().then(() => {
    // End the pool after running migrations as this is a standalone script
    pool.end();
});
