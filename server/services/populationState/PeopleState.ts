/**
 * PeopleState - Facade for Redis state management of people
 * 
 * This module re-exports functionality from specialized sub-modules:
 * - PersonCrud: Single-person CRUD operations
 * - BatchOperations: Batch operations for performance
 * - PendingOperations: Pending insert/update/delete tracking
 * - EligibleSets: Matchmaking eligibility sets
 * - Demographics: Population statistics
 * - PopulationSync: Sync between Redis and Postgres
 */

// Re-export types
export * from './types';

// Import all modules
import * as PersonCrud from './PersonCrud';
import * as BatchOperations from './BatchOperations';
import * as PendingOperations from './PendingOperations';
import * as EligibleSets from './EligibleSets';
import * as Demographics from './Demographics';
import * as PopulationSync from './PopulationSync';

/**
 * PeopleState class - Backward-compatible facade
 * Provides static methods that delegate to the specialized modules
 */
class PeopleState {
    // =========== ID ALLOCATION ===========
    static getNextId = PersonCrud.getNextId;
    static getIdBatch = PersonCrud.getIdBatch;

    // =========== SINGLE-PERSON CRUD ===========
    static addPerson = PersonCrud.addPerson;
    static removePerson = PersonCrud.removePerson;
    static getPerson = PersonCrud.getPerson;
    static updatePerson = PersonCrud.updatePerson;
    static getAllPeople = PersonCrud.getAllPeople;
    static getGlobalCounts = PersonCrud.getGlobalCounts;
    static getTotalPopulation = PersonCrud.getTotalPopulation;

    // =========== BATCH OPERATIONS ===========
    static batchAddPersons = BatchOperations.batchAddPersons;
    static batchRemovePersons = BatchOperations.batchRemovePersons;
    static batchClearFamilyIds = BatchOperations.batchClearFamilyIds;
    static batchDeleteFamilies = BatchOperations.batchDeleteFamilies;
    static reassignIds = BatchOperations.reassignIds;

    // =========== PENDING OPERATIONS ===========
    static getPendingInserts = PendingOperations.getPendingInserts;
    static getPendingUpdates = PendingOperations.getPendingUpdates;
    static getPendingDeletes = PendingOperations.getPendingDeletes;
    static clearPendingOperations = PendingOperations.clearPendingOperations;

    // =========== ELIGIBLE SETS ===========
    static addEligiblePerson = EligibleSets.addEligiblePerson;
    static removeEligiblePerson = EligibleSets.removeEligiblePerson;
    static getEligiblePeople = EligibleSets.getEligiblePeople;

    // =========== DEMOGRAPHICS ===========
    static getAllTilePopulations = Demographics.getAllTilePopulations;
    static getDemographicStats = Demographics.getDemographicStats;

    // =========== SYNC ===========
    static repairIfNeeded = PopulationSync.repairIfNeeded;
}

export default PeopleState;

// Also export individual modules for direct access
export {
    PersonCrud,
    BatchOperations,
    PendingOperations,
    EligibleSets,
    Demographics,
    PopulationSync
};
