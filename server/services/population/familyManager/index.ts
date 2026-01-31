// Family Manager - Main Export Module (Facade)
// Re-exports all family management functions from focused modules

export { createFamily } from './familyCreation';
export { startPregnancy } from './pregnancy';
export {
    deliverBaby,
    getFamiliesOnTile,
    processDeliveries,
    getFamilyStats
} from './delivery';
export { formNewFamilies } from './matchmaking';

// Re-export types for consumers
export type {
    CalendarService,
    PopulationServiceInstance,
    PersonRecord,
    FamilyRecord,
    DeliveryResult,
    FamilyStats
} from './types';

// Re-export helpers for external use
export {
    parseBirthDate,
    calculateAgeFromDates,
    getCurrentDate,
    formatDate,
    isMale,
    isFemale
} from './helpers';
