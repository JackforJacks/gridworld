/**
 * Population State - Backwards-compatible re-export
 * 
 * The implementation has been refactored into modular files:
 * - populationState/PeopleState.js - Person CRUD, demographics, eligible tracking
 * - populationState/FamilyState.js - Family CRUD, fertility tracking
 * - populationState/VillagePopulationState.js - Village population operations
 * - populationState/redisHelpers.js - Shared Redis utilities
 * 
 * This file re-exports the unified PopulationState class for backwards compatibility.
 */

export { default } from './populationState/index';
