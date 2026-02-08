// Load Operations - Main Orchestrator Module
// Loads saved state from a local bincode file into Redis + Rust ECS

import fs from 'fs';
import storage from '../../storage';
import { LoadContext, LoadResult, FamilyRow, PersonRow } from './types';
import { clearExistingStorageState } from './storageClear';
import { populateFertileFamilies, populateEligibleSets } from './populationSets';
import { SAVE_FILE } from '../saveOperations';

/** Chunk size for Redis pipeline writes */
const PIPELINE_CHUNK_SIZE = 2000;

/**
 * Load state from a bincode save file into Redis + Rust ECS.
 * Flow:
 *   1. Pause calendar
 *   2. Flush Redis
 *   3. Rust loadFromFile → restores ECS, returns nodeStateJson + seed
 *   4. Restore tiles, people + families to Redis from nodeStateJson
 *   6. Rebuild counts, eligible sets, fertile families
 *   7. Resume calendar
 */
export async function loadFromDatabase(context: LoadContext): Promise<LoadResult> {
    if (!storage.isAvailable()) {
        throw new Error('Storage not available - cannot load');
    }

    // Check save file exists
    if (!fs.existsSync(SAVE_FILE)) {
        throw new Error(`No save file found at ${SAVE_FILE}. Use Reset to create a new world first.`);
    }

    console.log(`📂 [LoadOperations] Loading state from ${SAVE_FILE}...`);
    const startTime = Date.now();

    const calendarWasRunning = pauseCalendar(context);

    try {
        // Flush Redis
        await clearExistingStorageState();

        // Load via Rust (restores ECS, returns node-side state + seed)
        const rustSimulation = require('../../rustSimulation').default;
        const loadResult = rustSimulation.loadFromFile(SAVE_FILE);

        console.log(`   🦀 Rust ECS restored: ${loadResult.population} people, ${loadResult.partners} partners, year ${loadResult.calendarYear}`);

        // Store seed in env for future saves
        process.env.WORLD_SEED = loadResult.seed.toString();

        // Parse node-side state
        const nodeState = JSON.parse(loadResult.nodeStateJson);
        const peopleData: Record<string, string> = nodeState.people || {};
        const familiesData: Record<string, string> = nodeState.families || {};
        const tilesData: Record<string, string> = nodeState.tiles || {};
        const tileFertilityData: Record<string, string> = nodeState.tileFertility || {};

        // Restore all data to Redis (tiles, people, families)
        const { maleCount, femaleCount } = await restoreToRedis(peopleData, familiesData, tilesData, tileFertilityData);
        const tilesGenerated = Object.keys(tilesData).length;
        const personCount = Object.keys(peopleData).length;
        const familyCount = Object.keys(familiesData).length;

        // Rebuild eligible matchmaking sets
        const people = buildPersonRows(peopleData);
        const families = buildFamilyRows(familiesData);
        await populateEligibleSets(people, context.calendarService, families);
        await populateFertileFamilies(families, people, context.calendarService);

        // Update calendar service if available
        if (context.calendarService?.loadStateFromDB) {
            await context.calendarService.loadStateFromDB();
        }

        resumeCalendar(context, calendarWasRunning);

        const elapsed = Date.now() - startTime;
        console.log(`✅ [LoadOperations] Loaded in ${elapsed}ms — ${tilesGenerated} tiles, ${personCount} people, ${familyCount} families`);

        return {
            people: personCount,
            families: familyCount,
            male: maleCount,
            female: femaleCount,
            tiles: tilesGenerated
        };
    } catch (error) {
        console.error('❌ [LoadOperations] Failed to load:', error);
        resumeCalendar(context, calendarWasRunning);
        throw error;
    }
}

// ===== Redis Restore =====

async function restoreToRedis(
    peopleData: Record<string, string>,
    familiesData: Record<string, string>,
    tilesData: Record<string, string>,
    tileFertilityData: Record<string, string>
): Promise<{ maleCount: number; femaleCount: number }> {
    type PipelineOp =
        | { type: 'hset'; key: string; field: string; value: string };

    const operations: PipelineOp[] = [];
    let maleCount = 0;
    let femaleCount = 0;

    // Tiles
    for (const [id, json] of Object.entries(tilesData)) {
        operations.push({ type: 'hset', key: 'tile', field: id, value: json });
    }

    // Tile fertility
    for (const [id, value] of Object.entries(tileFertilityData)) {
        operations.push({ type: 'hset', key: 'tile:fertility', field: id, value });
    }

    // People
    for (const [id, json] of Object.entries(peopleData)) {
        operations.push({ type: 'hset', key: 'person', field: id, value: json });
        try {
            const p = JSON.parse(json);
            if (p.sex === true || p.sex === 'true' || p.sex === 1 || p.sex === 't' || p.sex === 'M') {
                maleCount++;
            } else {
                femaleCount++;
            }
        } catch { /* ignore */ }
    }

    // Families
    for (const [id, json] of Object.entries(familiesData)) {
        operations.push({ type: 'hset', key: 'family', field: id, value: json });
    }

    // Global counts
    const totalPeople = Object.keys(peopleData).length;
    operations.push({ type: 'hset', key: 'counts:global', field: 'total', value: totalPeople.toString() });
    operations.push({ type: 'hset', key: 'counts:global', field: 'male', value: maleCount.toString() });
    operations.push({ type: 'hset', key: 'counts:global', field: 'female', value: femaleCount.toString() });
    operations.push({ type: 'hset', key: 'counts:global', field: 'nextTempId', value: '-1' });
    operations.push({ type: 'hset', key: 'counts:global', field: 'nextFamilyTempId', value: '-1' });

    // Execute in chunks
    for (let i = 0; i < operations.length; i += PIPELINE_CHUNK_SIZE) {
        const chunk = operations.slice(i, i + PIPELINE_CHUNK_SIZE);
        const pipeline = storage.pipeline();

        for (const op of chunk) {
            pipeline.hset(op.key, op.field, op.value);
        }

        await pipeline.exec();
    }

    return { maleCount, femaleCount };
}

// ===== Convert Redis JSON to row types for populationSets =====

function buildPersonRows(peopleData: Record<string, string>): PersonRow[] {
    const rows: PersonRow[] = [];
    for (const [, json] of Object.entries(peopleData)) {
        try {
            const p = JSON.parse(json);
            rows.push({
                id: p.id,
                tile_id: p.tile_id ?? null,
                sex: p.sex,
                health: p.health ?? 100,
                family_id: p.family_id ?? null,
                date_of_birth: p.date_of_birth
            });
        } catch { /* ignore */ }
    }
    return rows;
}

function buildFamilyRows(familiesData: Record<string, string>): FamilyRow[] {
    const rows: FamilyRow[] = [];
    for (const [, json] of Object.entries(familiesData)) {
        try {
            const f = JSON.parse(json);
            rows.push({
                id: f.id,
                husband_id: f.husband_id ?? null,
                wife_id: f.wife_id ?? null,
                tile_id: f.tile_id,
                pregnancy: f.pregnancy ?? null,
                delivery_date: f.delivery_date ?? null,
                children_ids: f.children_ids ?? null
            });
        } catch { /* ignore */ }
    }
    return rows;
}

// ===== Calendar Helpers =====

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

function resumeCalendar(context: LoadContext, wasRunning: boolean): void {
    if (wasRunning && context.calendarService?.start) {
        context.calendarService.start();
        console.log('▶️ Calendar resumed after world loading');
    }
}

// Re-export modules that other parts of the codebase may use
export { clearExistingStorageState } from './storageClear';
export { populateFertileFamilies, populateEligibleSets } from './populationSets';

// Re-export types
export type {
    LoadContext,
    LoadResult,
    CalendarService,
    CalendarDate,
    Pipeline,
    TileRow,
    PersonRow,
    FamilyRow
} from './types';
