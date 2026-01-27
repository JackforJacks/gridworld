/**
 * State Manager - Redis Operations
 * Handles Redis CRUD operations for villages, people, and tiles
 */

const redis = require('../../config/redis');
const { isRedisAvailable } = require('../../config/redis');

/**
 * Get a village from Redis
 */
async function getVillage(villageId) {
    const json = await redis.hget('village', villageId.toString());
    return json ? JSON.parse(json) : null;
}

/**
 * Update a village in Redis (no database write)
 */
async function updateVillage(villageId, updates) {
    const village = await getVillage(villageId);
    if (!village) return null;

    const updated = { ...village, ...updates };
    await redis.hset('village', villageId.toString(), JSON.stringify(updated));
    return updated;
}

/**
 * Get all villages from Redis
 */
async function getAllVillages() {
    const data = await redis.hgetall('village');
    return Object.values(data).map(json => JSON.parse(json));
}

/**
 * Get a person from Redis
 */
async function getPerson(personId) {
    const json = await redis.hget('person', personId.toString());
    return json ? JSON.parse(json) : null;
}

/**
 * Update a person in Redis (no database write)
 */
async function updatePerson(personId, updates) {
    const person = await getPerson(personId);
    if (!person) return null;

    const updated = { ...person, ...updates };
    await redis.hset('person', personId.toString(), JSON.stringify(updated));
    return updated;
}

/**
 * Get all people from Redis
 */
async function getAllPeople() {
    const data = await redis.hgetall('person');
    return Object.values(data).map(json => JSON.parse(json));
}

/**
 * Get population count for a village (from Redis index)
 */
async function getVillagePopulation(tileId, chunkIndex) {
    return await redis.scard(`village:${tileId}:${chunkIndex}:people`);
}

/**
 * Get fertility for a tile from Redis
 */
async function getTileFertility(tileId) {
    const val = await redis.hget('tile:fertility', tileId.toString());
    return parseInt(val) || 0;
}

/**
 * Get cleared land count for a village from Redis
 */
async function getVillageClearedLand(villageId) {
    const val = await redis.hget('village:cleared', villageId.toString());
    return parseInt(val) || 0;
}

/**
 * Add a single person record to Redis and index by village
 */
async function addPersonToRedis(person) {
    if (!isRedisAvailable()) return false;
    try {
        const id = person.id.toString();
        await redis.hset('person', id, JSON.stringify(person));
        // Index in village set if residency and tile_id present
        if (person.tile_id && person.residency !== null && person.residency !== undefined) {
            await redis.sadd(`village:${person.tile_id}:${person.residency}:people`, id);
        }
        return true;
    } catch (err) {
        console.warn('⚠️ Failed to add person to Redis:', err.message);
        return false;
    }
}

/**
 * Remove a person from Redis and village index
 */
async function removePersonFromRedis(personId) {
    if (!isRedisAvailable()) return false;
    try {
        const id = personId.toString();
        const json = await redis.hget('person', id);
        if (json) {
            const p = JSON.parse(json);
            if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                await redis.srem(`village:${p.tile_id}:${p.residency}:people`, id);
            }
        }
        await redis.hdel('person', id);
        return true;
    } catch (err) {
        console.warn('⚠️ Failed to remove person from Redis:', err.message);
        return false;
    }
}

/**
 * Clear all Redis state
 */
async function clearRedis() {
    const keys = await redis.keys('*');
    if (keys.length > 0) {
        await redis.del(...keys);
    }
    console.log('🗑️ Redis state cleared');
}

module.exports = {
    getVillage,
    updateVillage,
    getAllVillages,
    getPerson,
    updatePerson,
    getAllPeople,
    getVillagePopulation,
    getTileFertility,
    getVillageClearedLand,
    addPersonToRedis,
    removePersonFromRedis,
    clearRedis
};
