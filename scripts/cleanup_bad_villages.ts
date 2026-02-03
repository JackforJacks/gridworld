/**
 * Cleanup villages on uninhabitable tiles (ocean, mountains, etc.)
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

    // Get all villages from Redis
    const villages = await redis.hgetall('village');
    const badVillages: Array<{id: number, tile_id: number, terrain: string}> = [];

    for (const [id, json] of Object.entries(villages || {})) {
        const v = JSON.parse(json as string);
        const tileData = await redis.hget('tile', v.tile_id.toString());
        if (tileData) {
            const t = JSON.parse(tileData);
            if (t.terrain_type === 'ocean' || t.terrain_type === 'mountains' || !t.is_land || !t.is_habitable) {
                badVillages.push({id: parseInt(id), tile_id: v.tile_id, terrain: t.terrain_type});
            }
        }
    }

    console.log('Bad villages on uninhabitable tiles:', badVillages);

    // Delete from Postgres and Redis
    for (const v of badVillages) {
        console.log(`Deleting village ${v.id} on tile ${v.tile_id} (${v.terrain})...`);
        
        // Update people to remove residency (table is 'people' not 'person')
        await pool.query('UPDATE people SET residency = NULL WHERE residency = $1', [v.id]);
        // Delete village (table is 'villages' not 'village')
        await pool.query('DELETE FROM villages WHERE id = $1', [v.id]);
        // Remove from Redis
        await redis.hdel('village', v.id.toString());
    }

    // Fix people in Redis that were on bad tiles
    const people = await redis.hgetall('person');
    const badTileIds = badVillages.map(v => v.tile_id);
    let fixed = 0;

    for (const [id, json] of Object.entries(people || {})) {
        const p = JSON.parse(json as string);
        if (badTileIds.includes(p.tile_id)) {
            p.tile_id = null;
            p.residency = null;
            await redis.hset('person', id, JSON.stringify(p));
            fixed++;
        }
    }

    console.log(`Fixed ${fixed} people with bad tile assignments`);

    await redis.quit();
    await pool.end();
    console.log('Cleanup complete!');
}

cleanup().catch(console.error);
