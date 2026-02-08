/**
 * State Manager - Load Operations
 * Facade module - re-exports from modular loadOperations/ directory
 */

// Re-export from modular implementation
export {
    loadFromDatabase,
    clearExistingStorageState
    // populateFertileFamilies and populateEligibleSets removed - matchmaking/fertility now handled by Rust ECS
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
    // FamilyRow removed - families now managed by Rust ECS (Partner component)
    PeopleMap
} from './loadOperations/types';
