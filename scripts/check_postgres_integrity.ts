// Script to check for data integrity issues in Postgres
const { Pool } = require('pg');

async function checkDataIntegrity() {
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'gridworld',
        user: 'postgres',
        password: 'password'
    });

    try {
        console.log('🔍 Checking data integrity in Postgres...\n');

        // Check families with NULL husband or wife
        const nullSpouseQuery = `
            SELECT id, husband_id, wife_id, tile_id
            FROM family
            WHERE husband_id IS NULL OR wife_id IS NULL
            ORDER BY id
            LIMIT 20
        `;
        const nullSpouseResult = await pool.query(nullSpouseQuery);
        console.log(`Families with NULL spouse references: ${nullSpouseResult.rows.length}`);
        if (nullSpouseResult.rows.length > 0) {
            console.log('Sample families with NULL spouses:');
            nullSpouseResult.rows.forEach(row => {
                console.log(`  Family ${row.id}: husband=${row.husband_id}, wife=${row.wife_id}, tile=${row.tile_id}`);
            });
        }

        // Check if people referenced by families actually exist
        const familyPersonCheckQuery = `
            SELECT f.id as family_id, f.husband_id, f.wife_id,
                   CASE WHEN f.husband_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id = f.husband_id) THEN 'MISSING_HUSBAND' END as husband_status,
                   CASE WHEN f.wife_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id = f.wife_id) THEN 'MISSING_WIFE' END as wife_status
            FROM family f
            WHERE (f.husband_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id = f.husband_id))
               OR (f.wife_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id = f.wife_id))
            ORDER BY f.id
            LIMIT 20
        `;
        const missingPersonResult = await pool.query(familyPersonCheckQuery);
        console.log(`\nFamilies referencing non-existent people: ${missingPersonResult.rows.length}`);
        if (missingPersonResult.rows.length > 0) {
            console.log('Sample families with missing person references:');
            missingPersonResult.rows.forEach(row => {
                console.log(`  Family ${row.family_id}: ${row.husband_status || ''} ${row.wife_status || ''}`.trim());
            });
        }

        // Check people count vs families count
        const peopleCountQuery = 'SELECT COUNT(*) as count FROM people';
        const familiesCountQuery = 'SELECT COUNT(*) as count FROM family';
        const villagesCountQuery = 'SELECT COUNT(*) as count FROM villages';

        const [peopleCount, familiesCount, villagesCount] = await Promise.all([
            pool.query(peopleCountQuery),
            pool.query(familiesCountQuery),
            pool.query(villagesCountQuery)
        ]);

        console.log(`\nCounts:`);
        console.log(`  People: ${peopleCount.rows[0].count}`);
        console.log(`  Families: ${familiesCount.rows[0].count}`);
        console.log(`  Villages: ${villagesCount.rows[0].count}`);

        // Check for orphaned families (families with no people)
        const orphanedFamiliesQuery = `
            SELECT COUNT(*) as count
            FROM family f
            WHERE f.husband_id IS NULL AND f.wife_id IS NULL
        `;
        const orphanedResult = await pool.query(orphanedFamiliesQuery);
        console.log(`  Orphaned families (no spouses): ${orphanedResult.rows[0].count}`);

    } catch (error) {
        console.error('Data integrity check failed:', error);
    } finally {
        await pool.end();
    }
}

checkDataIntegrity().catch(console.error);