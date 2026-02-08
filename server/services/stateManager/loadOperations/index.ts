// Load Operations - Main Orchestrator Module
// Loads saved state from a local bincode file into Rust ECS

import fs from 'fs';
// Storage removed - all data in Rust ECS
import { LoadContext, LoadResult, PersonRow } from './types';
import { clearExistingStorageState } from './storageClear';
// populateEligibleSets and populateFertileFamilies removed - matchmaking/fertility now handled by Rust ECS
import { SAVE_FILE } from '../saveOperations';

/** Chunk size for Redis pipeline writes */
const PIPELINE_CHUNK_SIZE = 2000;

/**
 * Load state from a bincode save file into Rust ECS.
 * Flow:
 *   1. Pause calendar
 *   2. Rust loadFromFile → restores ECS, returns nodeStateJson + seed
 *   3. Resume calendar
 */
export async function loadFromDatabase(context: LoadContext): Promise<LoadResult> {
    // Storage removed - all data in Rust ECS

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

        // No node-side state to restore - everything in Rust ECS
        // Tiles are deterministic from seed, regenerated on-demand by /api/tiles
        const personCount = loadResult.population;

        // Update calendar service if available
        if (context.calendarService?.loadStateFromDB) {
            await context.calendarService.loadStateFromDB();
        }

        resumeCalendar(context, calendarWasRunning);

        const elapsed = Date.now() - startTime;
        console.log(`✅ [LoadOperations] Loaded in ${elapsed}ms — ${personCount} people`);

        return {
            people: personCount,
            families: 0, // Families tracked via Rust Partner component
            male: loadResult.partners, // Using partners count as proxy
            female: personCount - loadResult.partners,
            tiles: 0 // Tiles regenerated on-demand from seed
        };
    } catch (error) {
        console.error('❌ [LoadOperations] Failed to load:', error);
        resumeCalendar(context, calendarWasRunning);
        throw error;
    }
}

// No Redis restoration needed - tiles are deterministic, people/families in Rust ECS

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
// populateEligibleSets and populateFertileFamilies removed - matchmaking/fertility now handled by Rust ECS

// Re-export types
export type {
    LoadContext,
    LoadResult,
    CalendarService,
    CalendarDate,
    Pipeline,
    TileRow,
    PersonRow
    // FamilyRow removed - families now managed by Rust ECS (Partner component)
} from './types';
