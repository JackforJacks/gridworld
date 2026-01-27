/**
 * Population State - Barrel export for modular population state management
 * 
 * This module re-exports all population state classes for easy importing.
 * 
 * Usage:
 *   const { PeopleState, FamilyState, VillagePopulationState } = require('./populationState');
 * 
 * Or for backwards compatibility:
 *   const PopulationState = require('./populationState');
 *   // PopulationState is an alias for PeopleState with additional family/village methods
 */

const PeopleState = require('./PeopleState');
const FamilyState = require('./FamilyState');
const VillagePopulationState = require('./VillagePopulationState');
const storage = require('../storage');
const { getPool } = require('./redisHelpers');

/**
 * Backwards-compatible PopulationState class that delegates to the new modular classes
 * This allows existing code to continue working while we migrate
 */
class PopulationState {
    // Global flag to indicate restart/clear in progress - tick handlers should check this
    static isRestarting = false;

    /**
     * Initialize nextTempId from current min ID in Redis (call on load)
     */
    static async initTempIdCounter() {
        if (!storage.isAvailable()) return;
        try {
            await storage.hset('counts:global', 'nextTempId', '-1');
        } catch (err) {
            console.warn('[PopulationState] initTempIdCounter failed:', err.message);
        }
    }

    // =========== PERSON OPERATIONS (delegates to PeopleState) ===========
    static async getNextTempId() { return PeopleState.getNextTempId(); }
    static async addPerson(person, isNew) { return PeopleState.addPerson(person, isNew); }
    static async removePerson(personId, markDeleted) { return PeopleState.removePerson(personId, markDeleted); }
    static async getPerson(personId) { return PeopleState.getPerson(personId); }
    static async updatePerson(personId, updates) { return PeopleState.updatePerson(personId, updates); }
    static async getAllPeople() { return PeopleState.getAllPeople(); }
    static async getTilePopulation(tileId, residency) { return PeopleState.getTilePopulation(tileId, residency); }
    static async getGlobalCounts() { return PeopleState.getGlobalCounts(); }
    static async getTotalPopulation() { return PeopleState.getTotalPopulation(); }
    static async addEligiblePerson(personId, isMale, tileId) { return PeopleState.addEligiblePerson(personId, isMale, tileId); }
    static async removeEligiblePerson(personId) { return PeopleState.removeEligiblePerson(personId); }
    static async getEligiblePeople(isMale, tileId) { return PeopleState.getEligiblePeople(isMale, tileId); }
    static async getPendingInserts() { return PeopleState.getPendingInserts(); }
    static async getPendingUpdates() { return PeopleState.getPendingUpdates(); }
    static async getPendingDeletes() { return PeopleState.getPendingDeletes(); }
    static async clearPendingOperations() { return PeopleState.clearPendingOperations(); }
    static async reassignIds(mappings) { return PeopleState.reassignIds(mappings); }
    static async getAllTilePopulations() { return PeopleState.getAllTilePopulations(); }
    static async getDemographicStats(currentDate) { return PeopleState.getDemographicStats(currentDate); }
    static async syncFromPostgres() { return PeopleState.syncFromPostgres(); }

    // =========== FAMILY OPERATIONS (delegates to FamilyState) ===========
    static async getNextFamilyTempId() { return FamilyState.getNextTempId(); }
    static async addFamily(family, isNew) { return FamilyState.addFamily(family, isNew); }
    static async getFamily(familyId) { return FamilyState.getFamily(familyId); }
    static async updateFamily(familyId, updates) { return FamilyState.updateFamily(familyId, updates); }
    static async getAllFamilies() { return FamilyState.getAllFamilies(); }
    static async addFertileFamily(familyId, tileId) { return FamilyState.addFertileFamily(familyId, tileId); }
    static async removeFertileFamily(familyId) { return FamilyState.removeFertileFamily(familyId); }
    static async getFertileFamilies(tileId) { return FamilyState.getFertileFamilies(tileId); }
    static async getPendingFamilyInserts() { return FamilyState.getPendingInserts(); }
    static async getPendingFamilyUpdates() { return FamilyState.getPendingUpdates(); }
    static async getPendingFamilyDeletes() { return FamilyState.getPendingDeletes(); }
    static async clearPendingFamilyOperations() { return FamilyState.clearPendingOperations(); }
    static async reassignFamilyIds(mappings) { return FamilyState.reassignIds(mappings); }

    // =========== VILLAGE OPERATIONS (delegates to VillagePopulationState) ===========
    static async getPendingVillageInserts() { return VillagePopulationState.getPendingInserts(); }
    static async reassignVillageIds(mappings) { return VillagePopulationState.reassignIds(mappings); }
}

module.exports = PopulationState;

// Also export individual modules for direct access
module.exports.PeopleState = PeopleState;
module.exports.FamilyState = FamilyState;
module.exports.VillagePopulationState = VillagePopulationState;
module.exports.isRedisAvailable = () => storage.isAvailable();
module.exports.getRedis = () => {
    const adapter = storage.getAdapter ? storage.getAdapter() : storage;
    return adapter.client || adapter;
};
module.exports.getPool = getPool;
