/**
 * State Manager - Main Entry Point
 * Handles syncing state between Redis (hot data) and PostgreSQL (persistence)
 * 
 * This module has been refactored into:
 * - loadOperations.js - Loading state from PostgreSQL to Redis
 * - saveOperations.js - Saving Redis state to PostgreSQL
 * - redisOperations.js - Redis CRUD operations
 */

const { isRedisAvailable } = require('../../config/redis');
const { loadFromDatabase } = require('./loadOperations');
const { saveToDatabase } = require('./saveOperations');
const redisOps = require('./redisOperations');

class StateManager {
    static io = null;
    static initialized = false;
    static calendarService = null;

    static setIo(io) {
        this.io = io;
    }

    static setCalendarService(calendarService) {
        this.calendarService = calendarService;
    }

    /**
     * Check if Redis is available
     */
    static isRedisAvailable() {
        return isRedisAvailable();
    }

    /**
     * Load all data from PostgreSQL into Redis on server start
     */
    static async loadFromDatabase() {
        const result = await loadFromDatabase({
            calendarService: this.calendarService,
            io: this.io
        });
        if (!result.skipped) {
            this.initialized = true;
        }
        return result;
    }

    /**
     * Save all Redis state back to PostgreSQL
     */
    static async saveToDatabase() {
        if (!this.isRedisAvailable()) {
            throw new Error('Redis is not available - cannot save in-memory state to database');
        }
        return await saveToDatabase({
            calendarService: this.calendarService,
            io: this.io
        });
    }

    // Delegate Redis operations to redisOperations module
    static async getVillage(villageId) {
        return redisOps.getVillage(villageId);
    }

    static async updateVillage(villageId, updates) {
        return redisOps.updateVillage(villageId, updates);
    }

    static async getAllVillages() {
        return redisOps.getAllVillages();
    }

    static async getPerson(personId) {
        return redisOps.getPerson(personId);
    }

    static async updatePerson(personId, updates) {
        return redisOps.updatePerson(personId, updates);
    }

    static async getAllPeople() {
        return redisOps.getAllPeople();
    }

    static async getVillagePopulation(tileId, chunkIndex) {
        return redisOps.getVillagePopulation(tileId, chunkIndex);
    }

    static async getTileFertility(tileId) {
        return redisOps.getTileFertility(tileId);
    }

    static async getVillageClearedLand(villageId) {
        return redisOps.getVillageClearedLand(villageId);
    }

    static async addPersonToRedis(person) {
        return redisOps.addPersonToRedis(person);
    }

    static async removePersonFromRedis(personId) {
        return redisOps.removePersonFromRedis(personId);
    }

    /**
     * Check if Redis state is initialized
     */
    static isInitialized() {
        return this.initialized;
    }

    /**
     * Clear all Redis state (useful for testing)
     */
    static async clearRedis() {
        await redisOps.clearRedis();
        this.initialized = false;
    }
}

module.exports = StateManager;
