// Load Operations - Main Orchestrator Module
// Handles loading saved state from PostgreSQL into Redis

import storage from '../../storage';
import { LoadContext, LoadResult, Pipeline } from './types';
import { clearExistingStorageState } from './storageClear';
import { fetchTiles, fetchTilesLands, TileLoadResult, LandLoadResult } from './tileLoader';
import { fetchPeople, PersonLoadResult } from './peopleLoader';
import { fetchFamilies, FamilyLoadResult } from './familyLoader';
import { populateFertileFamilies, populateEligibleSets } from './populationSets';

// Legacy imports for backward compatibility
import { loadTiles, loadTilesLands } from './tileLoader';
import { loadPeople } from './peopleLoader';
import { loadFamilies } from './familyLoader';

/** Chunk size for pipeline execution to avoid memory issues */
const PIPELINE_CHUNK_SIZE = 2000;

/**
 * Load state from PostgreSQL into Redis
 * This is used when explicitly clicking "Load" to restore saved state
 * @param context - StateManager context with calendarService, io
 * @returns Load results
 */
export async function loadFromDatabase(context: LoadContext): Promise<LoadResult> {
    if (!storage.isAvailable()) {
        console.warn('⚠️ storage not available, cannot load from database');
        throw new Error('Storage not available - cannot load from database');
    }

    console.log('📂 [LoadOperations] Loading state from PostgreSQL...');
    const startTime = Date.now();

    // Pause calendar during load
    const calendarWasRunning = pauseCalendar(context);

    try {
        // Clear existing Redis state
        await clearExistingStorageState();

        // Fetch tiles and lands first
        const [tilesResult, landsResult] = await Promise.all([
            fetchTiles(),
            fetchTilesLands()
        ]);

        // Fetch people and families
        const [peopleResult, familiesResult] = await Promise.all([
            fetchPeople(),
            fetchFamilies()
        ]);

        console.log(`   Fetched: ${tilesResult.tiles.length} tiles, ${peopleResult.people.length} people, ${familiesResult.families.length} families`);

        // If database is empty, fail with clear error message
        if (tilesResult.tiles.length === 0) {
            resumeCalendar(context, calendarWasRunning);
            throw new Error('Database is empty - no saved data to load. Use Reset to create a new world first.');
        }

        if (peopleResult.people.length === 0) {
            resumeCalendar(context, calendarWasRunning);
            throw new Error('No population data found in database. Use Reset to create a new world first.');
        }

        // Write all data to Redis in batched pipeline
        await executeChunkedPipeline(tilesResult, landsResult, peopleResult, familiesResult);

        // Populate eligible sets for matchmaking
        await populateEligibleSets(peopleResult.people, context.calendarService, familiesResult.families);

        // Populate fertile families sets
        await populateFertileFamilies(familiesResult.families, peopleResult.people, context.calendarService);

        // Reload calendar state from DB
        await reloadCalendarState(context);

        // Restore Rust simulation state from DB (if saved)
        await loadRustSimulationState();

        // Resume calendar if it was running
        resumeCalendar(context, calendarWasRunning);

        const elapsed = Date.now() - startTime;
        console.log(`✅ [LoadOperations] Loaded from PostgreSQL in ${elapsed}ms — ${tilesResult.tiles.length} tiles, ${peopleResult.people.length} people, ${familiesResult.families.length} families`);

        return {
            people: peopleResult.people.length,
            families: familiesResult.families.length,
            male: peopleResult.maleCount,
            female: peopleResult.femaleCount,
            tiles: tilesResult.tiles.length,
            tilesLands: landsResult.count
        };
    } catch (error) {
        console.error('❌ [LoadOperations] Failed to load from PostgreSQL:', error);
        resumeCalendar(context, calendarWasRunning);
        throw error;
    }
}

/**
 * Execute Redis pipeline in chunks to avoid memory issues with large datasets
 */
async function executeChunkedPipeline(
    tilesResult: TileLoadResult,
    landsResult: LandLoadResult,
    peopleResult: PersonLoadResult,
    familiesResult: FamilyLoadResult
): Promise<void> {
    // Collect all operations
    type PipelineOp =
        | { type: 'hset'; key: string; field: string; value: string }
        | { type: 'sadd'; key: string; member: string };

    const operations: PipelineOp[] = [];

    // Tiles
    for (const t of tilesResult.tilesData) {
        operations.push({ type: 'hset', key: 'tile', field: t.id, value: t.json });
        if (t.fertility !== null) {
            operations.push({ type: 'hset', key: 'tile:fertility', field: t.id, value: t.fertility });
        }
    }

    // Lands
    for (const l of landsResult.landsData) {
        operations.push({ type: 'hset', key: 'tile:lands', field: l.tileId, value: l.json });
    }

    // People
    for (const p of peopleResult.peopleData) {
        operations.push({ type: 'hset', key: 'person', field: p.id, value: p.json });
    }

    // Families
    for (const f of familiesResult.familiesData) {
        operations.push({ type: 'hset', key: 'family', field: f.id, value: f.json });
    }

    // Global counts
    operations.push({ type: 'hset', key: 'counts:global', field: 'total', value: peopleResult.people.length.toString() });
    operations.push({ type: 'hset', key: 'counts:global', field: 'male', value: peopleResult.maleCount.toString() });
    operations.push({ type: 'hset', key: 'counts:global', field: 'female', value: peopleResult.femaleCount.toString() });
    operations.push({ type: 'hset', key: 'counts:global', field: 'nextTempId', value: '-1' });
    operations.push({ type: 'hset', key: 'counts:global', field: 'nextFamilyTempId', value: '-1' });

    // Execute in chunks
    for (let i = 0; i < operations.length; i += PIPELINE_CHUNK_SIZE) {
        const chunk = operations.slice(i, i + PIPELINE_CHUNK_SIZE);
        const pipeline = storage.pipeline();

        for (const op of chunk) {
            if (op.type === 'hset') {
                pipeline.hset(op.key, op.field, op.value);
            } else {
                pipeline.sadd(op.key, op.member);
            }
        }

        await pipeline.exec();
    }
}

// ===== Helper Functions =====

async function handleRedisFirstMode(context: LoadContext): Promise<LoadResult> {
    console.log('[StateManager] REDIS_FIRST=true, skipping Postgres load and Redis flush');

    // Resume calendar if we paused it earlier
    let calendarWasRunning = false;
    if (context.calendarService?.state) {
        calendarWasRunning = context.calendarService.state.isRunning;
    }
    if (calendarWasRunning && context.calendarService?.start) {
        context.calendarService.start();
    }

    // Return current Redis counts
    const personCount = typeof storage.hlen === 'function' ? await storage.hlen('person') : 0;
    const familyCount = typeof storage.hlen === 'function' ? await storage.hlen('family') : 0;

    return { people: personCount, families: familyCount, skipped: true };
}

function pauseCalendar(context: LoadContext): boolean {
    let calendarWasRunning = false;
    if (context.calendarService?.stop) {
        calendarWasRunning = context.calendarService.state?.isRunning ?? false;
        if (calendarWasRunning) {
            context.calendarService.stop();
            console.log('⏸️ Calendar paused during world loading');
        }
    }
    return calendarWasRunning;
}

async function reloadCalendarState(context: LoadContext): Promise<void> {
    if (context.calendarService?.loadStateFromDB) {
        await context.calendarService.loadStateFromDB();
    }
}

/**
 * Load Rust simulation state from PostgreSQL
 * Restores the entire Rust ECS world from saved JSON
 */
async function loadRustSimulationState(): Promise<void> {
    const pool = require('../../../config/database').default;
    
    try {
        const result = await pool.query(`
            SELECT state_json, population, calendar_year 
            FROM rust_simulation_state 
            WHERE id = 1
        `);
        
        if (result.rows.length === 0) {
            console.log('🦀 No saved Rust simulation state found, will sync from Redis');
            // Fall back to syncing from Redis (legacy behavior)
            const rustSimulation = require('../../rustSimulation').default;
            await rustSimulation.syncFromRedis();
            return;
        }
        
        const { state_json, population, calendar_year } = result.rows[0];
        
        // Import the saved state
        const rustSimulation = require('../../rustSimulation').default;
        const importResult = rustSimulation.importWorld(state_json);
        
        console.log(`🦀 [PostgreSQL] Loaded Rust simulation state: ${importResult.population} people, ${importResult.partners} partners, year ${importResult.calendarYear}`);
    } catch (err: unknown) {
        // Table might not exist yet - fall back to Redis sync
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('does not exist')) {
            console.log('🦀 rust_simulation_state table not found, syncing from Redis');
            const rustSimulation = require('../../rustSimulation').default;
            await rustSimulation.syncFromRedis();
        } else {
            console.warn('⚠️ Failed to load Rust simulation state:', errMsg);
            // Still try to sync from Redis as fallback
            const rustSimulation = require('../../rustSimulation').default;
            await rustSimulation.syncFromRedis();
        }
    }
}

function resumeCalendar(context: LoadContext, wasRunning: boolean): void {
    if (wasRunning && context.calendarService?.start) {
        context.calendarService.start();
        console.log('▶️ Calendar resumed after world loading');
    }
}

// Re-export all modules for direct access
export { clearExistingStorageState } from './storageClear';
export { loadTiles, loadTilesLands, fetchTiles, fetchTilesLands } from './tileLoader';
export { loadPeople, fetchPeople } from './peopleLoader';
export { loadFamilies, fetchFamilies } from './familyLoader';
export { populateFertileFamilies, populateEligibleSets } from './populationSets';

// Re-export types
export type {
    LoadContext,
    LoadResult,
    CalendarService,
    CalendarDate,
    Pipeline,
    TileRow,
    LandRow,
    PersonRow,
    FamilyRow
} from './types';
