/**
 * State Manager - Storage Operations
 * Storage removed - all data in Rust ECS
 */

// Storage removed - all data in Rust ECS

/**
 * Get a person from Redis
 * Storage removed - all data in Rust ECS
 */
async function getPerson(personId) {
    console.warn('getPerson deprecated - use rustSimulation directly');
    return null;
}

/**
 * Update a person in Redis
 * Storage removed - all data in Rust ECS
 */
async function updatePerson(personId, updates) {
    console.warn('updatePerson deprecated - use rustSimulation directly');
    return null;
}

/**
 * Get all people from Redis
 * Storage removed - all data in Rust ECS
 */
async function getAllPeople() {
    console.warn('getAllPeople deprecated - use rustSimulation directly');
    return [];
}

/**
 * Get population count from Redis
 * Storage removed - all data in Rust ECS
 */
async function getPopulationCount(): Promise<number> {
    console.warn('getPopulationCount deprecated - use rustSimulation directly');
    return 0;
}

/**
 * Get fertility for a tile from Redis
 * Storage removed - all data in Rust ECS
 */
async function getTileFertility(tileId) {
    console.warn('getTileFertility deprecated - use rustSimulation directly');
    return 0;
}

/**
 * Add a single person record to Redis
 * Storage removed - all data in Rust ECS
 */
async function addPersonToStorage(person) {
    console.warn('addPersonToStorage deprecated - use rustSimulation directly');
    return false;
}

/**
 * Remove a person from Redis
 * Storage removed - all data in Rust ECS
 */
async function removePersonFromStorage(personId) {
    console.warn('removePersonFromStorage deprecated - use rustSimulation directly');
    return false;
}

/**
 * Clear all Redis state
 * Storage removed - all data in Rust ECS
 */
async function clearStorage() {
    console.log('🗑️ Storage removed - all data in Rust ECS');
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
