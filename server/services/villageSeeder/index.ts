/**
 * Village Seeder - Main Entry Point
 * Handles village creation and seeding
 * 
 * This module has been refactored into:
 * - dbUtils.ts - Database schema utilities
 * - postgresSeeding.ts - Postgres-based village seeding
 * - redisSeeding.ts - Redis-first village seeding (PRIMARY - all initialization goes here)
 * - residency.ts - Residency assignment utilities
 * 
 * NOTE: All world initialization is Redis-first. Data is only persisted to Postgres when save is invoked.
 */

import { seedRandomVillages, seedVillagesForTile } from './postgresSeeding';
import { seedVillagesStorageFirst, seedWorldIfEmpty, SeedVillagesResult } from './redisSeeding';
import { assignResidencyForTile } from './residency';
import storage from '../storage';
import pool from '../../config/database';
import PopulationState from '../populationState';

// Re-export SeedVillagesResult for external use
export type { SeedVillagesResult };

/**
 * @deprecated Use seedWorldIfEmpty() instead - called automatically by StateManager.loadFromDatabase()
 * Seed villages if none exist in the database
 * @returns {Promise<Object>} Result with created count and villages
 */
async function seedIfNoVillages() {
    console.warn('[villageSeeder] seedIfNoVillages() is deprecated - seeding is now handled by StateManager.loadFromDatabase()');
    try {
        // Check if any villages exist
        const { rows: existingVillages } = await pool.query('SELECT COUNT(*) as count FROM villages');
        const villageCount = parseInt(existingVillages[0].count);

        if (villageCount > 0) {
            console.log(`[villageSeeder] ${villageCount} villages already exist, skipping seeding`);
            return { created: 0, villages: [] };
        }

        console.log('[villageSeeder] No villages found, seeding initial villages...');

        // --- REDIS-FIRST CHECK ---
        if (storage.isAvailable()) {
            const peopleCount = await PopulationState.getTotalPopulation();
            const villagesData = await storage.hgetall('village');
            const villagesCountRedis = villagesData ? Object.keys(villagesData).length : 0;
            if (peopleCount > 0 && villagesCountRedis > 0) {
                console.log(`[villageSeeder] Redis already has ${villagesCountRedis} villages and ${peopleCount} people, skipping fallback seeding.`);
                return { created: 0, villages: [] };
            }
            // If Redis has people but no villages, seed villages from storage
            if (peopleCount > 0) {
                console.log(`[villageSeeder] Redis has ${peopleCount} people, will seed villages from storage.`);
                const result = await seedVillagesStorageFirst();
                console.log(`[villageSeeder] Seeded ${result.created} initial villages`);
                return result;
            }
        }
        // --- END REDIS-FIRST CHECK ---

        // Check if there are any populated tiles
        const { rows: populatedTiles } = await pool.query(`
            SELECT DISTINCT tile_id FROM people WHERE tile_id IS NOT NULL
        `);

        if (!populatedTiles || populatedTiles.length === 0) {
            console.log('[villageSeeder] No populated tiles found, creating initial population and villages...');
            await createInitialWorld();
        }

        // Now seed villages using storage-first approach since people are in Redis
        const result = await seedVillagesStorageFirst();

        // DEBUG: Check Redis state after seeding (use HLEN to avoid loading all data)
        const debugPersonCount = await storage.hlen('person') || 0;
        const debugVillageCount = await storage.hlen('village') || 0;
        console.log(`[DEBUG] After seeding - person hash: ${debugPersonCount}, village hash: ${debugVillageCount}`);

        console.log(`[villageSeeder] Seeded ${result.created} initial villages`);
        return result;

    } catch (error: unknown) {
        console.error('[villageSeeder] Error seeding villages if none exist:', error);
        throw error;
    }
}

/**
 * Create initial world with tiles and population
 * Delegates to the Redis-first approach - all data goes to Redis first,
 * then persisted to Postgres when save is invoked
 */
async function createInitialWorld() {
    console.log('[villageSeeder] Creating initial world using Redis-first approach...');
    // Use the Redis-first seeding from redisSeeding.ts
    const result = await seedWorldIfEmpty();
    console.log(`[villageSeeder] Initial world created: ${result.people} people, ${result.villages} villages`);
}

/**
 * @deprecated Use seedWorldIfEmpty() from redisSeeding.ts instead
 * This function is kept for backwards compatibility but delegates to Redis-first approach
 */
async function createInitialTiles() {
    console.warn('[villageSeeder] createInitialTiles is deprecated - using Redis-first approach');
    // The Redis-first approach handles tile selection internally
    // Return empty array - actual tile selection happens in seedWorldIfEmpty
    return [];
}

/**
 * @deprecated Legacy function - population is now created via createInitialPopulationRedisFirst in redisSeeding.ts
 */
async function createInitialPopulation(tileId: number) {
    console.warn(`[villageSeeder] createInitialPopulation is deprecated for tile ${tileId} - use Redis-first approach`);
    // No-op - population creation is handled by seedWorldIfEmpty -> createInitialPopulationRedisFirst
}

export {
    seedRandomVillages,
    seedIfNoVillages, // @deprecated - kept for test compatibility
    seedWorldIfEmpty, // Redis-first world seeding - used by StateManager
    assignResidencyForTile,
    seedVillagesStorageFirst,
    seedVillagesForTile
};
