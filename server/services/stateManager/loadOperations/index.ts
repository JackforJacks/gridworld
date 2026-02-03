// Load Operations - Main Orchestrator Module
// Redis-first: Uses unified WorldRestart service for initialization
// Postgres is only used for explicit save/load/autosave operations

import storage from '../../storage';
import { restartWorld } from '../../worldRestart';
import { LoadContext, LoadResult, SeedWorldResult, Pipeline } from './types';
import { clearExistingStorageState } from './storageClear';
import { fetchTiles, fetchTilesLands, TileLoadResult, LandLoadResult } from './tileLoader';
import { fetchVillages, fetchClearedLandCounts, VillageLoadResult, LandCountLoadResult } from './villageLoader';
import { fetchPeople, PersonLoadResult } from './peopleLoader';
import { fetchFamilies, FamilyLoadResult } from './familyLoader';
import { populateFertileFamilies, populateEligibleSets } from './populationSets';

// Legacy imports for backward compatibility
import { loadTiles, loadTilesLands } from './tileLoader';
import { loadVillages, loadClearedLandCounts } from './villageLoader';
import { loadPeople } from './peopleLoader';
import { loadFamilies } from './familyLoader';

/** Chunk size for pipeline execution to avoid memory issues */
const PIPELINE_CHUNK_SIZE = 2000;

/**
 * Initialize state on server startup (Redis-only, no Postgres)
 * Uses unified WorldRestart service for clean, optimized initialization
 * Postgres is only used for explicit save/load/autosave operations
 * @param context - StateManager context with calendarService, io
 * @returns Load results
 */
export async function loadFromDatabase(context: LoadContext): Promise<LoadResult> {
    if (!storage.isAvailable()) {
        console.warn('⚠️ storage not available, skipping state load');
        return { villages: 0, people: 0, families: 0, skipped: true };
    }

    // Use unified WorldRestart service for initialization
    const result = await restartWorld({
        skipCalendarReset: false,
        context: {
            calendarService: context.calendarService,
            io: context.io
        }
    });

    if (!result.success) {
        console.error('❌ World restart failed:', result.error);
        return { villages: 0, people: 0, families: 0, skipped: true };
    }

    return {
        villages: result.villages,
        people: result.people,
        families: 0,
        male: 0,
        female: 0,
        tiles: result.tiles,
        tilesLands: 0,
        seeded: true
    };
}

/**
 * Execute Redis pipeline in chunks to avoid memory issues with large datasets
 */
async function executeChunkedPipeline(
    tilesResult: TileLoadResult,
    landsResult: LandLoadResult,
    villagesResult: VillageLoadResult,
    peopleResult: PersonLoadResult,
    familiesResult: FamilyLoadResult,
    landCountsResult: LandCountLoadResult
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

    // Villages
    for (const v of villagesResult.villagesData) {
        operations.push({ type: 'hset', key: 'village', field: v.id, value: v.json });
    }

    // People
    for (const p of peopleResult.peopleData) {
        operations.push({ type: 'hset', key: 'person', field: p.id, value: p.json });
        if (p.villageKey) {
            operations.push({ type: 'sadd', key: `village:${p.villageKey}:people`, member: p.id });
        }
    }

    // Families
    for (const f of familiesResult.familiesData) {
        operations.push({ type: 'hset', key: 'family', field: f.id, value: f.json });
    }

    // Land counts
    for (const lc of landCountsResult.landCountsData) {
        operations.push({ type: 'hset', key: 'village:cleared', field: lc.villageId, value: lc.count });
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
    const villageCount = typeof storage.hlen === 'function' ? await storage.hlen('village') : 0;
    const personCount = typeof storage.hlen === 'function' ? await storage.hlen('person') : 0;
    const familyCount = typeof storage.hlen === 'function' ? await storage.hlen('family') : 0;

    return { villages: villageCount, people: personCount, families: familyCount, skipped: true };
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

function resumeCalendar(context: LoadContext, wasRunning: boolean): void {
    if (wasRunning && context.calendarService?.start) {
        context.calendarService.start();
        console.log('▶️ Calendar resumed after world loading');
    }
}

async function validateAndRepairVillages(people: { id: number }[]): Promise<void> {
    if (people.length === 0) return;

    const VillageManager = require('../../villageSeeder/villageManager');
    const validation = await VillageManager.validateVillageConsistency();

    if (!validation.valid) {
        console.warn(`[StateManager] ⚠️ Village consistency issues detected: ${validation.issues.length} issues`);
        for (const issue of validation.issues.slice(0, 5)) {
            console.warn(`[StateManager]   - ${issue.type}: tile ${issue.tileId}`);
        }

        const repairResult = await VillageManager.ensureVillagesForPopulatedTiles({ force: true });
        if (repairResult.success) {
            console.log(`[StateManager] ✅ Village repair complete: ${repairResult.created} created, ${repairResult.assigned} assigned`);
        } else {
            console.error(`[StateManager] ❌ Village repair failed: ${repairResult.error}`);
        }
    } else {
        // Rebuild membership sets to ensure correctness
        try {
            const PeopleState = require('../../populationState/PeopleState').default;
            await PeopleState.rebuildVillageMemberships();
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.warn('[StateManager] Failed to rebuild village memberships:', errMsg);
        }
    }
}

async function seedWorldIfEmpty(people: { id: number }[]): Promise<SeedWorldResult | null> {
    if (people.length > 0) return null;

    console.log('[StateManager] No people loaded from Postgres, seeding new world...');
    const { seedWorldIfEmpty } = require('../../villageSeeder/redisSeeding') as {
        seedWorldIfEmpty: () => Promise<SeedWorldResult>;
    };
    const seedResult = await seedWorldIfEmpty();

    if (seedResult?.seeded) {
        const VillageManager = require('../../villageSeeder/villageManager');
        await VillageManager.ensureVillagesForPopulatedTiles({ force: false });
    }

    return seedResult;
}

// Re-export all modules for direct access
export { clearExistingStorageState } from './storageClear';
export { loadTiles, loadTilesLands, fetchTiles, fetchTilesLands } from './tileLoader';
export { loadVillages, loadClearedLandCounts, fetchVillages, fetchClearedLandCounts } from './villageLoader';
export { loadPeople, fetchPeople } from './peopleLoader';
export { loadFamilies, fetchFamilies } from './familyLoader';
export { populateFertileFamilies, populateEligibleSets } from './populationSets';

// Re-export types
export type {
    LoadContext,
    LoadResult,
    SeedWorldResult,
    CalendarService,
    CalendarDate,
    Pipeline,
    TileRow,
    LandRow,
    VillageRow,
    PersonRow,
    FamilyRow
} from './types';
