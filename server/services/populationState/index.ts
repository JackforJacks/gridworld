/**
 * Population State - Barrel export for modular population state management
 * 
 * This module re-exports all population state classes for easy importing.
 * 
 * Usage:
 *   import { PeopleState, FamilyState, VillagePopulationState } from './populationState';
 * 
 * Or for backwards compatibility:
 *   import PopulationState from './populationState';
 *   // PopulationState is an alias for PeopleState with additional family/village methods
 */

import PeopleState from './PeopleState';
import FamilyState from './FamilyState';
import VillagePopulationState from './VillagePopulationState';
import storage from '../storage';
import { getPool } from './redisHelpers';
import type { FamilyData } from '../../../types/global';

/** Person input data type for add/update operations */
interface PersonInput {
    id: number;
    tile_id?: number | null;
    residency?: number | null;
    sex?: boolean;
    health?: number;
    date_of_birth?: string | Date;
    family_id?: number | null;
}

/** Person updates type */
interface PersonUpdates {
    tile_id?: number | null;
    residency?: number | null;
    sex?: boolean;
    health?: number;
    date_of_birth?: string | Date;
    family_id?: number | null;
}

/** Stored person type from Redis */
interface StoredPerson {
    id: number;
    tile_id: number | null;
    residency: number | null;
    sex: boolean;
    health: number;
    date_of_birth: string | Date;
    family_id: number | null;
    _isNew?: boolean;
}

/** Stored family type from Redis */
interface StoredFamilyData extends FamilyData {
    _isNew?: boolean;
}

/** ID mapping type for reassignment */
interface IdMapping {
    tempId: number;
    newId: number;
}

/** Global counts type */
interface GlobalCounts {
    total: number;
    male: number;
    female: number;
}

/** Current date type for demographics */
interface CurrentDate {
    year: number;
    month: number;
    day: number;
}

/** Demographic statistics type */
interface DemographicStats {
    totalPopulation: number;
    male: number;
    female: number;
    minors: number;
    working_age: number;
    elderly: number;
    bachelors: number;
}

/** Residency update type */
interface ResidencyUpdate {
    personId: number;
    newResidency: number;
}

/**
 * Backwards-compatible PopulationState class that delegates to the new modular classes
 * This allows existing code to continue working while we migrate
 */
class PopulationState {
    // Global flag to indicate restart/clear in progress - tick handlers should check this
    static isRestarting: boolean = false;

    /**
     * Initialize nextTempId from current min ID in Redis (call on load)
     */
    static async initTempIdCounter(): Promise<void> {
        if (!storage.isAvailable()) return;
        try {
            await storage.hset('counts:global', 'nextTempId', '-1');
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            console.warn('[PopulationState] initTempIdCounter failed:', error.message);
        }
    }

    // =========== PERSON OPERATIONS (delegates to PeopleState) ===========
    static async getNextId(): Promise<number> { return PeopleState.getNextId(); }
    static async addPerson(person: PersonInput, isNew: boolean): Promise<boolean> { return PeopleState.addPerson(person, isNew); }
    static async removePerson(personId: number | string, markDeleted?: boolean): Promise<boolean> { return PeopleState.removePerson(Number(personId), markDeleted); }
    static async getPerson(personId: number | string): Promise<StoredPerson | null> { return PeopleState.getPerson(Number(personId)); }
    static async updatePerson(personId: number | string, updates: PersonUpdates): Promise<boolean> { return PeopleState.updatePerson(Number(personId), updates); }
    static async getAllPeople(): Promise<StoredPerson[]> { return PeopleState.getAllPeople(); }
    static async getTilePopulation(tileId: number | string, residency?: number): Promise<StoredPerson[]> { return PeopleState.getTilePopulation(Number(tileId), residency ?? 0); }
    static async getGlobalCounts(): Promise<GlobalCounts> { return PeopleState.getGlobalCounts(); }
    static async getTotalPopulation(): Promise<number> { return PeopleState.getTotalPopulation(); }
    static async addEligiblePerson(personId: number | string, isMale: boolean, tileId: number | string): Promise<boolean> { return PeopleState.addEligiblePerson(Number(personId), isMale, Number(tileId)); }
    static async removeEligiblePerson(personId: number | string): Promise<boolean> { return PeopleState.removeEligiblePerson(Number(personId)); }
    static async getEligiblePeople(isMale: boolean, tileId?: number | string): Promise<string[]> { return PeopleState.getEligiblePeople(isMale, tileId !== undefined ? Number(tileId) : 0); }
    static async getPendingInserts(): Promise<StoredPerson[]> { return PeopleState.getPendingInserts(); }
    static async getPendingUpdates(): Promise<StoredPerson[]> { return PeopleState.getPendingUpdates(); }
    static async getPendingDeletes(): Promise<number[]> { return PeopleState.getPendingDeletes(); }
    static async clearPendingOperations(): Promise<void> { return PeopleState.clearPendingOperations(); }
    static async reassignIds(mappings: IdMapping[]): Promise<void> { return PeopleState.reassignIds(mappings); }
    static async getAllTilePopulations(): Promise<Record<number, number>> { return PeopleState.getAllTilePopulations(); }
    static async getDemographicStats(currentDate: CurrentDate): Promise<DemographicStats | null> { return PeopleState.getDemographicStats(currentDate); }
    static async syncFromPostgres(): Promise<ReturnType<typeof PeopleState.syncFromPostgres>> { return PeopleState.syncFromPostgres(); }
    static async rebuildVillageMemberships(): Promise<ReturnType<typeof PeopleState.rebuildVillageMemberships>> { return PeopleState.rebuildVillageMemberships(); }
    static async repairIfNeeded(): Promise<ReturnType<typeof PeopleState.repairIfNeeded>> { return PeopleState.repairIfNeeded(); }

    // =========== BATCH OPERATIONS (delegates to PeopleState) ===========
    static async batchClearFamilyIds(personIds: (number | string)[]): Promise<number> { return PeopleState.batchClearFamilyIds(personIds.map(Number)); }
    static async batchRemovePersons(personIds: (number | string)[], markDeleted?: boolean): Promise<number> { return PeopleState.batchRemovePersons(personIds.map(Number), markDeleted); }
    static async batchDeleteFamilies(familyIds: (number | string)[], markDeleted?: boolean): Promise<number> { return PeopleState.batchDeleteFamilies(familyIds.map(Number), markDeleted); }
    static async batchAddPersons(persons: PersonInput[], isNew?: boolean): Promise<number> { return PeopleState.batchAddPersons(persons, isNew); }
    static async batchUpdateResidency(updates: ResidencyUpdate[]): Promise<number> { return PeopleState.batchUpdateResidency(updates); }
    static async getIdBatch(count: number): Promise<number[]> { return PeopleState.getIdBatch(count); }

    // =========== FAMILY OPERATIONS (delegates to FamilyState) ===========
    static async getNextFamilyId(): Promise<number> { return FamilyState.getNextId(); }
    static async addFamily(family: FamilyData, isNew?: boolean): Promise<boolean> { return FamilyState.addFamily(family, isNew); }
    static async getFamily(familyId: number | string): Promise<StoredFamilyData | null> { return FamilyState.getFamily(Number(familyId)); }
    static async updateFamily(familyId: number | string, updates: Partial<FamilyData>): Promise<boolean> { return FamilyState.updateFamily(Number(familyId), updates); }
    static async getAllFamilies(): Promise<StoredFamilyData[]> { return FamilyState.getAllFamilies(); }
    static async addFertileFamily(familyId: number | string, tileId: number | string): Promise<boolean> { return FamilyState.addFertileFamily(Number(familyId), Number(tileId)); }
    static async removeFertileFamily(familyId: number | string): Promise<boolean> { return FamilyState.removeFertileFamily(Number(familyId)); }
    static async getFertileFamilies(tileId?: number | string): Promise<string[]> { return FamilyState.getFertileFamilies(tileId !== undefined ? Number(tileId) : 0); }
    static async getPendingFamilyInserts(): Promise<StoredFamilyData[]> { return FamilyState.getPendingInserts(); }
    static async getPendingFamilyUpdates(): Promise<StoredFamilyData[]> { return FamilyState.getPendingUpdates(); }
    static async getPendingFamilyDeletes(): Promise<number[]> { return FamilyState.getPendingDeletes(); }
    static async clearPendingFamilyOperations(): Promise<void> { return FamilyState.clearPendingOperations(); }
    static async reassignFamilyIds(mappings: IdMapping[]): Promise<void> { return FamilyState.reassignIds(mappings); }

    // =========== VILLAGE OPERATIONS (delegates to VillagePopulationState) ===========
    static async getPendingVillageInserts(): Promise<ReturnType<typeof VillagePopulationState.getPendingInserts>> { return VillagePopulationState.getPendingInserts(); }
    static async reassignVillageIds(mappings: IdMapping[]): Promise<ReturnType<typeof VillagePopulationState.reassignIds>> { return VillagePopulationState.reassignIds(mappings); }
}

export default PopulationState;

// Also export individual modules for direct access
export { PeopleState, FamilyState, VillagePopulationState };
export const isRedisAvailable = (): boolean => storage.isAvailable();
export const getRedis = (): ReturnType<typeof storage.getAdapter> | typeof storage => {
    const adapter = storage.getAdapter ? storage.getAdapter() : storage;
    return adapter;
};
export { getPool };
