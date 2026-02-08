/**
 * State Manager - Load Operations
 * Facade module - re-exports from modular loadOperations/ directory
 */

// Re-export from modular implementation
export {
    loadFromDatabase,
    clearExistingStorageState,
    populateFertileFamilies,
    populateEligibleSets
} from './loadOperations/index';

export type {
    LoadContext,
    LoadResult,
    CalendarService,
    CalendarDate,
    CalendarState,
    Pipeline,
    TileRow,
    PersonRow,
    FamilyRow,
    PeopleMap
} from './loadOperations/types';
