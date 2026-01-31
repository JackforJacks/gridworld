/**
 * State Manager - Load Operations
 * Facade module - re-exports from modular loadOperations/ directory
 * 
 * Split into focused modules for maintainability:
 * - types.ts: All type definitions
 * - storageClear.ts: Redis cleanup on load
 * - tileLoader.ts: Load tiles and lands
 * - villageLoader.ts: Load villages and counts
 * - peopleLoader.ts: Load people with demographics
 * - familyLoader.ts: Load families
 * - populationSets.ts: Populate fertile/eligible sets
 * - index.ts: Main orchestrator
 */

// Re-export everything from modular implementation
export {
    loadFromDatabase,
    clearExistingStorageState,
    loadTiles,
    loadTilesLands,
    loadVillages,
    loadClearedLandCounts,
    loadPeople,
    loadFamilies,
    populateFertileFamilies,
    populateEligibleSets
} from './loadOperations/index';

export type {
    LoadContext,
    LoadResult,
    SeedWorldResult,
    CalendarService,
    CalendarDate,
    CalendarState,
    Pipeline,
    TileRow,
    LandRow,
    VillageRow,
    PersonRow,
    FamilyRow,
    LoadPeopleResult,
    LandCountRow,
    LandsByTile,
    PeopleMap,
    VillageIdLookup,
    ValidationIssue
} from './loadOperations/types';
