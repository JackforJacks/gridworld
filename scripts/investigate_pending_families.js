// Script to investigate pending family inserts and check person references
const Redis = require('ioredis');
const { Pool } = require('pg');

async function investigatePendingFamilies() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        db: 0
    });

    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'gridworld',
        user: 'postgres',
        password: 'password'
    });

    try {
        console.log('🔍 Investigating pending family inserts...\n');

        // Get pending family insert IDs
        const pendingFamilyIds = await redis.smembers('pending:family:inserts');
        console.log(`Found ${pendingFamilyIds.length} pending family inserts`);

        if (pendingFamilyIds.length === 0) {
            console.log('No pending families to investigate.');
            return;
        }

        // Get family data from Redis
        const pipeline = redis.pipeline();
        for (const id of pendingFamilyIds) {
            pipeline.hget('family', id.toString());
        }
        const results = await pipeline.exec();

        const families = [];
        for (const [err, json] of results) {
            if (!err && json) {
                try {
                    families.push(JSON.parse(json));
                } catch (e) {
                    console.warn(`Invalid JSON for family ${id}:`, e.message);
                }
            }
        }

        console.log(`Successfully parsed ${families.length} family objects\n`);

        // Collect all referenced person IDs
        const referencedPersonIds = new Set();
        for (const family of families) {
            if (family.husband_id > 0) referencedPersonIds.add(family.husband_id);
            if (family.wife_id > 0) referencedPersonIds.add(family.wife_id);
        }

        console.log(`Total unique person IDs referenced by pending families: ${referencedPersonIds.size}`);

        // Check which people exist in Postgres
        if (referencedPersonIds.size > 0) {
            const personIdsArray = Array.from(referencedPersonIds);
            const res = await pool.query('SELECT id FROM people WHERE id = ANY($1::int[])', [personIdsArray]);
            const existingPersonIds = new Set(res.rows.map(r => r.id));

            console.log(`People found in Postgres: ${existingPersonIds.size}/${referencedPersonIds.size}`);

            // Find missing people
            const missingPersonIds = personIdsArray.filter(id => !existingPersonIds.has(id));
            console.log(`Missing person IDs: ${missingPersonIds.length}`);
            if (missingPersonIds.length > 0) {
                console.log('Sample missing IDs:', missingPersonIds.slice(0, 10));
            }

            // Check which families reference missing people
            console.log('\nFamilies referencing missing people:');
            let count = 0;
            for (const family of families) {
                const husbandMissing = family.husband_id > 0 && !existingPersonIds.has(family.husband_id);
                const wifeMissing = family.wife_id > 0 && !existingPersonIds.has(family.wife_id);

                if (husbandMissing || wifeMissing) {
                    console.log(`Family ${family.id}: husband=${family.husband_id}${husbandMissing ? ' (MISSING)' : ''}, wife=${family.wife_id}${wifeMissing ? ' (MISSING)' : ''}`);
                    count++;
                    if (count >= 20) { // Limit output
                        console.log('... (truncated)');
                        break;
                    }
                }
            }
        }

        // Also check if these families already exist in Postgres
        console.log('\nChecking if families already exist in Postgres...');
        const familyIdsArray = families.map(f => f.id);
        const familyRes = await pool.query('SELECT id FROM families WHERE id = ANY($1::int[])', [familyIdsArray]);
        const existingFamilyIds = new Set(familyRes.rows.map(r => r.id));

        console.log(`Families already in Postgres: ${existingFamilyIds.size}/${families.length}`);

        if (existingFamilyIds.size > 0) {
            console.log('Sample existing family IDs:', Array.from(existingFamilyIds).slice(0, 10));
        }

    } catch (error) {
        console.error('Investigation failed:', error);
    } finally {
        await redis.quit();
        await pool.end();
    }
}

investigatePendingFamilies().catch(console.error);