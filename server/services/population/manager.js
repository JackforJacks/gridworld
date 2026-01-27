// server/services/population/manager.js
const { getRandomSex, getRandomAge, getRandomBirthDate } = require('./calculator.js');
const { trackBirths, trackDeaths } = require('./PopStats.js');
const config = require('../../config/server.js');

/**
 * Add people to a tile - Redis-only (Postgres writes happen on Save)
 * @param {Pool} pool - Database pool (used for fallback/queries only)
 * @param {number} tileId - Tile ID
 * @param {number} count - Number of people to add
 * @param {number} currentYear - Current year
 * @param {number} currentMonth - Current month
 * @param {number} currentDay - Current day
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {boolean} doTrackBirths - Whether to track births
 */
async function addPeopleToTile(pool, tileId, count, currentYear, currentMonth, currentDay, populationServiceInstance, doTrackBirths = false) {
    const PopulationState = require('../populationState');
    const { isRedisAvailable } = require('../../config/redis');

    if (!isRedisAvailable()) {
        console.warn('⚠️ Redis not available - cannot add people to tile');
        return;
    }

    for (let i = 0; i < count; i++) {
        const sex = getRandomSex();
        const age = getRandomAge();
        const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);

        // Get a temporary ID for Redis-only storage
        const tempId = await PopulationState.getNextTempId();

        const personObj = {
            id: tempId,
            tile_id: tileId,
            residency: null, // Will be assigned later
            sex: sex,
            date_of_birth: birthDate,
            health: 100,
            family_id: null
        };

        // Add to Redis with isNew=true to track for batch Postgres insert
        await PopulationState.addPerson(personObj, true);

        // If the person is already adult and single, add to eligible matchmaking sets
        try {
            await PopulationState.addEligiblePerson(personObj, currentYear, currentMonth, currentDay);
        } catch (e) {
            console.warn('[addPeopleToTile] failed to add eligible person:', e && e.message ? e.message : e);
        }
    }

    if (doTrackBirths && populationServiceInstance && typeof trackBirths === 'function') {
        trackBirths(populationServiceInstance, count);
    }
}

/**
 * Remove people from a tile - Redis-only (Postgres deletes happen on Save)
 * @param {Pool} pool - Database pool (used for queries only)
 * @param {number} tileId - Tile ID
 * @param {number} count - Number of people to remove
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {boolean} doTrackDeaths - Whether to track deaths
 */
async function removePeopleFromTile(pool, tileId, count, populationServiceInstance, doTrackDeaths = false) {
    if (count <= 0) return;

    const PopulationState = require('../populationState');
    const { isRedisAvailable } = require('../../config/redis');

    if (!isRedisAvailable()) {
        console.warn('⚠️ Redis not available - cannot remove people from tile');
        return;
    }

    // Get all people from Redis and filter by tile
    const allPeople = await PopulationState.getAllPeople();
    const tilePopulation = allPeople.filter(p => p.tile_id === tileId);

    // Randomly select people to remove
    const shuffled = tilePopulation.sort(() => Math.random() - 0.5);
    const toRemove = shuffled.slice(0, Math.min(count, shuffled.length));

    for (const person of toRemove) {
        // Remove from Redis and track for batch Postgres delete
        await PopulationState.removePerson(person.id, true);
    }

    if (doTrackDeaths && populationServiceInstance && typeof trackDeaths === 'function') {
        trackDeaths(populationServiceInstance, toRemove.length);
    }
}

module.exports = { addPeopleToTile, removePeopleFromTile };
