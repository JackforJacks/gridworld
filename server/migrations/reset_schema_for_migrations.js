// reset_schema_for_migrations.js
// This script drops the 'family' and 'people' tables and removes their migration records.
// After running this, re-run your migration runner to restore the schema in the correct order.

const pool = require('../config/database');

async function resetSchema() {
    const client = await pool.connect();
    try {
        console.log('Dropping tables if they exist...');
        await client.query('DROP TABLE IF EXISTS people CASCADE');
        await client.query('DROP TABLE IF EXISTS family CASCADE');
        console.log('Tables dropped.');

        // Remove migration records so they will be re-run
        console.log('Cleaning up schema_migrations table...');
        await client.query(`DELETE FROM schema_migrations WHERE version = '002_create_family_table.sql'`);
        await client.query(`DELETE FROM schema_migrations WHERE version = '003_add_family_id_to_people.sql'`);
        console.log('Migration records removed.');
    } catch (err) {
        console.error('Error during schema reset:', err);
    } finally {
        client.release();
        pool.end();
    }
}

resetSchema().then(() => {
    console.log('\n✅ Schema reset complete. Now run your migration runner again:');
    console.log('   node server/migrations/run_migrations.js');
});
