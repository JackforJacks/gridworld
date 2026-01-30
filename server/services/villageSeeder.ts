/**
 * Village Seeder - Backwards-compatible re-export
 * 
 * The implementation has been refactored into modular files:
 * - villageSeeder/dbUtils.js - Database schema utilities
 * - villageSeeder/postgresSeeding.js - Postgres-based village seeding
 * - villageSeeder/redisSeeding.js - Redis-first village seeding
 * - villageSeeder/residency.js - Residency assignment utilities
 * - villageSeeder/index.js - Main exports
 * 
 * This file re-exports the module for backwards compatibility.
 */

export * from './villageSeeder/index';
