/**
 * Population State - Backwards-compatible re-export
 * 
 * The implementation has been refactored into modular files:
 * - populationState/PeopleState.ts - Person CRUD, demographics, eligible tracking
 * - populationState/FamilyState.ts - Family CRUD, fertility tracking
 * - populationState/VillagePopulationState.ts - Village population operations
 * - populationState/redisHelpers.ts - Shared Redis utilities
 * 
 * This file re-exports the unified PopulationState class for backwards compatibility.
 */

export { default } from './populationState/index';
