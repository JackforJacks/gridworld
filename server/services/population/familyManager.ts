// Family Manager - Facade Module
// This file re-exports from focused modules for backward compatibility
// The actual implementation is now split across:
//   - familyManager/types.ts - Type definitions
//   - familyManager/helpers.ts - Date/sex parsing utilities
//   - familyManager/familyCreation.ts - Family creation
//   - familyManager/pregnancy.ts - Pregnancy management
//   - familyManager/delivery.ts - Baby delivery and stats
//   - familyManager/matchmaking.ts - Matchmaking and pairing

export {
    createFamily,
    startPregnancy,
    deliverBaby,
    getFamiliesOnTile,
    processDeliveries,
    getFamilyStats,
    formNewFamilies
} from './familyManager/index';
