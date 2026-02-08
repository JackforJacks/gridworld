// Population Operations - Main Export Module (Facade)

export { formatPopData, loadPopData, getAge } from './helpers';

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
