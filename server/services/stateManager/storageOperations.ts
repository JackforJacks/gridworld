/**
 * State Manager - Storage Operations
 * Handles storage CRUD operations for villages, people, and tiles
 */

import storage from '../storage';

/**
 * Get a village from Redis
 */
async function getVillage(villageId) {
    const json = await storage.hget('village', villageId.toString());
    return json ? JSON.parse(json) : null;
}

/**
 * Update a village in Redis (no database write)
 */
async function updateVillage(villageId, updates) {
    const village = await getVillage(villageId);
    if (!village) return null;

    const updated = { ...village, ...updates };
    await storage.hset('village', villageId.toString(), JSON.stringify(updated));
    return updated;
}

/**
 * Get all villages from Redis
 */
async function getAllVillages() {
    const data = await storage.hgetall('village');
    return Object.values(data).map(json => JSON.parse(json as string));
}

/**
 * Get a person from Redis
 */
async function getPerson(personId) {
    const json = await storage.hget('person', personId.toString());
    return json ? JSON.parse(json) : null;
}

/**
 * Update a person in Redis (no database write)
 */
async function updatePerson(personId, updates) {
    const person = await getPerson(personId);
    if (!person) return null;

    const updated = { ...person, ...updates };
    await storage.hset('person', personId.toString(), JSON.stringify(updated));
    return updated;
}

/**
 * Get all people from Redis
 */
async function getAllPeople() {
    const data = await storage.hgetall('person');
    return Object.values(data).map(json => JSON.parse(json as string));
}

/**
 * Get population count from Redis (O(1) operation)
 */
async function getPopulationCount(): Promise<number> {
    return await storage.hlen('person');
}

/**
 * Get population count for a village (from Redis index)
 */
async function getVillagePopulation(tileId, chunkIndex) {
    return await storage.scard(`village:${tileId}:${chunkIndex}:people`);
}

/**
 * Get fertility for a tile from Redis
 */
async function getTileFertility(tileId) {
    const val = await storage.hget('tile:fertility', tileId.toString());
    return parseInt(val) || 0;
}

/**
 * Get cleared land count for a village from Redis
 */
async function getVillageClearedLand(villageId) {
    const val = await storage.hget('village:cleared', villageId.toString());
    return parseInt(val) || 0;
}

/**
 * Add a single person record to Redis and index by village
 */
async function addPersonToStorage(person) {
    if (!storage.isAvailable()) return false;
    try {
        const id = person.id.toString();
        await storage.hset('person', id, JSON.stringify(person));
        // Index in village set if residency is a valid village ID (> 0)
        if (person.tile_id && person.residency !== null && person.residency !== undefined && person.residency !== 0) {
            await storage.sadd(`village:${person.tile_id}:${person.residency}:people`, id);
        }
        return true;
    } catch (err: unknown) {
        console.warn('⚠️ Failed to add person to storage:', (err as Error).message);
        return false;
    }
}

/**
 * Remove a person from Redis and village index
 */
async function removePersonFromStorage(personId) {
    if (!storage.isAvailable()) return false;
    try {
        const id = personId.toString();
        const json = await storage.hget('person', id);
        if (json) {
            const p = JSON.parse(json);
            if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                await storage.srem(`village:${p.tile_id}:${p.residency}:people`, id);
            }
        }
        await storage.hdel('person', id);
        return true;
    } catch (err: unknown) {
        console.warn('⚠️ Failed to remove person from storage:', (err as Error).message);
        return false;
    }
}

/**
 * Clear all Redis state
 */
async function clearStorage() {
    const keys = await storage.keys('*');
    if (keys.length > 0) {
        await storage.del(...keys);
    }
    console.log('🗑️ Storage state cleared');
}

export {
    getVillage,
    updateVillage,
    getAllVillages,
    getPerson,
    updatePerson,
    getAllPeople,
    getPopulationCount,
    getVillagePopulation,
    getTileFertility,
    getVillageClearedLand,
    addPersonToStorage,
    removePersonFromStorage,
    clearStorage
};
