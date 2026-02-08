/**
 * State Manager - Storage Operations
 * Handles storage CRUD operations for people and tiles
 */

import storage from '../storage';

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
 * Get fertility for a tile from Redis
 */
async function getTileFertility(tileId) {
    const val = await storage.hget('tile:fertility', tileId.toString());
    return parseInt(val) || 0;
}

/**
 * Add a single person record to Redis
 */
async function addPersonToStorage(person) {
    if (!storage.isAvailable()) return false;
    try {
        const id = person.id.toString();
        await storage.hset('person', id, JSON.stringify(person));
        return true;
    } catch (err: unknown) {
        console.warn('⚠️ Failed to add person to storage:', (err as Error).message);
        return false;
    }
}

/**
 * Remove a person from Redis
 */
async function removePersonFromStorage(personId) {
    if (!storage.isAvailable()) return false;
    try {
        const id = personId.toString();
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
    getPerson,
    updatePerson,
    getAllPeople,
    getPopulationCount,
    getTileFertility,
    addPersonToStorage,
    removePersonFromStorage,
    clearStorage
};
