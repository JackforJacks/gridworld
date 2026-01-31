// Population Operations - Main Export Module (Facade)
// Re-exports all population operations from focused modules

export { formatPopData, loadPopData, getAge } from './helpers';
export { clearStoragePopulation, resetAllPopulation } from './storageReset';
export { generatePeopleForTiles } from './peopleGenerator';
export { seedFamiliesForTiles } from './familySeeder';
export { initializeTilePopulations } from './tileInitializer';
export {
    updateTilePopulation,
    updateMultipleTilePopulations,
    regeneratePopulationWithNewAgeDistribution
} from './populationUpdater';

// Re-export types
export type {
    CalendarDate,
    CalendarService,
    PopulationServiceInstance,
    PopulationOptions,
    TilePopulations,
    FormattedPopulationData,
    PersonRecord,
    FamilyRecord,
    PopulationStateModule,
    CalculatorModule,
    TilePopulationMap,
    TilePopulationTargets
} from './types';
