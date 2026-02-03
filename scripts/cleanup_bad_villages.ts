/**
 * Cleanup villages on uninhabitable tiles (ocean, mountains, etc.)
 * Optimized with batch Redis/Postgres operations
 */
import { Pool } from 'pg';
import Redis from 'ioredis';

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gridworld',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function cleanup() {
    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        db: parseInt(process.env.REDIS_DB || '0')
    });

    console.time('cleanup');

    // Get all villages and tiles in parallel
    const [villages, tiles] = await Promise.all([
        redis.hgetall('village'),
        redis.hgetall('tile')
    ]);

    // Build tile lookup map for O(1) access
    const tileMap = new Map<string, { terrain_type: string; is_land: boolean; is_habitable: boolean }>();
    for (const [id, json] of Object.entries(tiles || {})) {
        tileMap.set(id, JSON.parse(json as string));
    }

    // Identify bad villages
    const badVillages: Array<{ id: number; tile_id: number; terrain: string }> = [];
    for (const [id, json] of Object.entries(villages || {})) {
        const v = JSON.parse(json as string);
        const t = tileMap.get(v.tile_id.toString());
        if (t && (t.terrain_type === 'ocean' || t.terrain_type === 'mountains' || !t.is_land || !t.is_habitable)) {
            badVillages.push({ id: parseInt(id), tile_id: v.tile_id, terrain: t.terrain_type });
        }
    }

    console.log(`Found ${badVillages.length} bad villages on uninhabitable tiles`);
    if (badVillages.length === 0) {
        await redis.quit();
        await pool.end();
        console.timeEnd('cleanup');
        return;
    }

    badVillages.forEach(v => console.log(`  - Village ${v.id} on tile ${v.tile_id} (${v.terrain})`));

    const badVillageIds = badVillages.map(v => v.id);
    const badTileIds = new Set(badVillages.map(v => v.tile_id));

    // Batch Postgres operations in a transaction
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Batch update people residency
        await client.query(
            'UPDATE people SET residency = NULL WHERE residency = ANY($1::int[])',
            [badVillageIds]
        );

        // Batch delete villages
        await client.query(
            'DELETE FROM villages WHERE id = ANY($1::int[])',
            [badVillageIds]
        );

        await client.query('COMMIT');
        console.log(`Deleted ${badVillageIds.length} villages from Postgres`);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    // Batch delete villages from Redis using pipeline
    const pipeline = redis.pipeline();
    for (const id of badVillageIds) {
        pipeline.hdel('village', id.toString());
    }
    await pipeline.exec();
    console.log(`Deleted ${badVillageIds.length} villages from Redis`);

    // Fix people in Redis with bad tile assignments
    const people = await redis.hgetall('person');
    const peopleToFix: Array<[string, string]> = [];

    for (const [id, json] of Object.entries(people || {})) {
        const p = JSON.parse(json as string);
        if (badTileIds.has(p.tile_id)) {
            p.tile_id = null;
            p.residency = null;
            peopleToFix.push([id, JSON.stringify(p)]);
        }
    }

    // Batch update people in Redis using pipeline
    if (peopleToFix.length > 0) {
        const peoplePipeline = redis.pipeline();
        for (const [id, json] of peopleToFix) {
            peoplePipeline.hset('person', id, json);
        }
        await peoplePipeline.exec();
    }
    console.log(`Fixed ${peopleToFix.length} people with bad tile assignments`);

    await redis.quit();
    await pool.end();
    console.timeEnd('cleanup');
    console.log('Cleanup complete!');
}

cleanup().catch(console.error);
