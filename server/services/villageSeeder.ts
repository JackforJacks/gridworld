/**
 * Village Seeder - Backwards-compatible re-export
 * 
 * The implementation has been refactored into modular files:
 * - villageSeeder/dbUtils.ts - Database schema utilities
 * - villageSeeder/postgresSeeding.ts - Postgres-based village seeding
 * - villageSeeder/redisSeeding.ts - Redis-first village seeding
 * - villageSeeder/residency.ts - Residency assignment utilities
 * - villageSeeder/index.ts - Main exports
 * 
 * This file re-exports the module for backwards compatibility.
 */

export * from './villageSeeder/index';
