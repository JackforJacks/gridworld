// Population Operations - Facade Module
// This file re-exports from focused modules for backward compatibility
// The actual implementation is now split across:
//   - operations/types.ts - Type definitions
//   - operations/helpers.ts - Helper functions
//   - operations/storageReset.ts - Storage clearing and reset
//   - operations/peopleGenerator.ts - People generation
//   - operations/familySeeder.ts - Family creation
//   - operations/tileInitializer.ts - Tile population initialization
//   - operations/populationUpdater.ts - Population updates

export {
    updateTilePopulation,
    resetAllPopulation,
    initializeTilePopulations,
    updateMultipleTilePopulations,
    regeneratePopulationWithNewAgeDistribution
} from './operations/index';

export type { FormattedPopulationData } from './operations/types';
