/**
 * Clear all population data to allow fresh seeding
 */
import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0')
});

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gridworld',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function clearAll() {
    console.log('Clearing all villages, people, and families...');

    // Clear from Postgres
    await pool.query('UPDATE people SET residency = NULL, family_id = NULL');
    await pool.query('DELETE FROM villages');
    await pool.query('DELETE FROM family');
    await pool.query('DELETE FROM people');
    console.log('Cleared Postgres tables.');

    // Clear from Redis
    await redis.del('village');
    await redis.del('person');
    await redis.del('family');
    await redis.del('tile:populations');
    console.log('Cleared Redis hashes.');

    // Clear ID counters
    await redis.del('next_id:people');
    await redis.del('next_id:family');
    await redis.del('next_id:villages');
    console.log('Cleared ID counters.');

    // Clear population sets
    const eligibleKeys = await redis.keys('eligible:*');
    for (const k of eligibleKeys) await redis.del(k);
    console.log(`Cleared ${eligibleKeys.length} eligible sets.`);

    const fertileKeys = await redis.keys('fertile:*');
    for (const k of fertileKeys) await redis.del(k);
    console.log(`Cleared ${fertileKeys.length} fertile sets.`);

    // Clear village people sets
    const villageKeys = await redis.keys('village:*');
    for (const k of villageKeys) await redis.del(k);
    console.log(`Cleared ${villageKeys.length} village sets.`);

    console.log('✅ Cleared all population data. Restart server to re-seed.');

    await redis.quit();
    await pool.end();
}

clearAll().catch(console.error);
