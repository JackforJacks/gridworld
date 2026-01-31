// Population Operations - Tile Initializer Module
import { Pool } from 'pg';
import serverConfig from '../../../config/server';
import storage from '../../storage';
import * as deps from '../dependencyContainer';
import { validateTileIds } from '../validation';
import { savePopulationData } from '../dataOperations';
import { verifyAndRepairIntegrity } from '../integrity';
import {
    CalendarService,
    PopulationServiceInstance,
    PopulationOptions,
    FormattedPopulationData,
    TilePopulations,
    PopulationStateModule,
    CalculatorModule
} from './types';
import { formatPopData, loadPopData } from './helpers';
import { clearStoragePopulation } from './storageReset';
import { generatePeopleForTiles } from './peopleGenerator';
import { seedFamiliesForTiles } from './familySeeder';

/**
 * Initializes population for multiple tiles
 * @param pool - Database pool instance
 * @param calendarService - Calendar service instance
 * @param serviceInstance - Population service instance
 * @param tileIds - Array of tile IDs to initialize
 * @param options - Options for initialization
 * @returns Formatted population data
 */
export async function initializeTilePopulations(
    pool: Pool,
    calendarService: CalendarService | null,
    serviceInstance: PopulationServiceInstance,
    tileIds: number[],
    options: PopulationOptions = {}
): Promise<FormattedPopulationData> {
    const flag = options ? options.preserveDatabase : false;
    const preserveDatabase = flag === true || flag === 'true';
    const forceAll = options && options.forceAll === true;

    if (serverConfig.verboseLogs) {
        console.log('[PopulationOperations] initializeTilePopulations called with tileIds:', tileIds);
        if (preserveDatabase) {
            console.log('[PopulationOperations] Preserving Postgres data during initialization');
        }
    }
    const startTime = Date.now();

    try {
        const PopulationState = deps.getPopulationState() as unknown as PopulationStateModule | null;
        if (!PopulationState) {
            throw new Error('PopulationState module not available');
        }

        validateTileIds(tileIds);

        // Check if population already exists in Redis
        const existingResult = await checkExistingPopulation(PopulationState, forceAll);
        if (existingResult) {
            return existingResult;
        }

        if (serverConfig.verboseLogs) {
            console.log('[PopulationOperations] No existing population found. Proceeding with storage-first initialization...');
        }

        // Select tiles for initialization
        const selectedTiles = await selectTilesForInitialization(tileIds);
        if (selectedTiles.length === 0) {
            console.warn('[PopulationOperations] initializeTilePopulations: No tiles selected.');
            return {
                success: false,
                message: 'No tiles selected',
                tilePopulations: {},
                totalPopulation: 0,
                totalTiles: 0,
                lastUpdated: new Date().toISOString()
            };
        }

        // Clear storage and database if needed
        if (!preserveDatabase && !forceAll) {
            if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Clearing data...');
            await clearStoragePopulation();
            await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');
            if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Clear done in ${Date.now() - startTime}ms`);
        }

        // Get current date
        const { currentYear, currentMonth, currentDay } = getCurrentDate(calendarService);

        const calculator = deps.getCalculator() as CalculatorModule | null;
        if (!calculator) {
            throw new Error('Calculator module not available');
        }

        // Step 1: Generate people
        const step1Start = Date.now();
        const { allPeople, tilePopulationMap, tilePopulationTargets } = await generatePeopleForTiles(
            selectedTiles,
            currentYear,
            currentMonth,
            currentDay,
            calculator
        );
        if (serverConfig.verboseLogs) {
            console.log(`⏱️ [initPop] Step 1 done: ${allPeople.length} people generated in ${Date.now() - step1Start}ms`);
        }

        // Step 2: Create families
        const step2Start = Date.now();
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Step 2: Creating families in memory...');
        const { allFamilies, allPeople: updatedPeople } = await seedFamiliesForTiles(
            selectedTiles,
            allPeople,
            tilePopulationMap,
            tilePopulationTargets,
            currentYear,
            currentMonth,
            currentDay,
            calculator
        );
        if (serverConfig.verboseLogs) {
            console.log(`⏱️ [initPop] Step 2 done: ${allFamilies.length} families created in ${Date.now() - step2Start}ms`);
        }

        // Step 3: Write to Redis using batch operations
        const step3Start = Date.now();
        if (serverConfig.verboseLogs) console.log('⏱️ [initPop] Step 3: Writing to storage...');
        await PopulationState.batchAddPersons(updatedPeople, true);
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Added ${updatedPeople.length} people to storage`);
        await PopulationState.batchAddFamilies(allFamilies, true);
        if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Added ${allFamilies.length} families to storage`);
        if (serverConfig.verboseLogs) {
            console.log(`⏱️ [initPop] Step 3 done: storage write completed in ${Date.now() - step3Start}ms`);
        }

        // Integrity verification
        await runIntegrityCheck(pool, selectedTiles, tilePopulationTargets);

        // Optionally persist to Postgres
        await persistToPostgres();

        // Wait for storage to reflect all tiles
        await waitForStorageSync(PopulationState, selectedTiles);

        // Return formatted result
        const totalTime = Date.now() - startTime;
        if (serverConfig.verboseLogs) {
            console.log(`✅ [initPop] COMPLETE: ${updatedPeople.length} people, ${allFamilies.length} families in ${totalTime}ms`);
        }

        const populations = await getFinalPopulations(pool, PopulationState);
        logMismatches(populations, selectedTiles, tilePopulationTargets);

        // Broadcast update
        try {
            if (serviceInstance && typeof serviceInstance.broadcastUpdate === 'function') {
                await serviceInstance.broadcastUpdate('populationUpdate');
            }
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.warn('[initPop] broadcastUpdate failed:', errorMessage);
        }

        return formatPopData(populations);
    } catch (error: unknown) {
        console.error('[PopulationOperations] Critical error in initializeTilePopulations:', error);
        console.error('[PopulationOperations] tileIds at time of error:', tileIds);
        throw error;
    }
}

// ===== Helper Functions =====

async function checkExistingPopulation(
    PopulationState: PopulationStateModule,
    forceAll: boolean
): Promise<FormattedPopulationData | null> {
    if (forceAll) return null;

    const existingCount = await PopulationState.getTotalPopulation();
    if (existingCount > 0) {
        let populations: TilePopulations;
        try {
            populations = await PopulationState.getAllTilePopulations();
        } catch {
            populations = {};
        }
        const tilesFound = populations && Object.keys(populations).length ? Object.keys(populations).length : 0;

        if (tilesFound > 0) {
            if (serverConfig.verboseLogs) {
                console.log(`[PopulationOperations] Found ${existingCount} existing people in Redis and ${tilesFound} populated tiles. Using existing population.`);
            }
            return {
                success: true,
                message: `Using existing population data (${existingCount} people)`,
                isExisting: true,
                ...formatPopData(populations)
            };
        }

        // Inconsistent state - try to rebuild
        console.warn('[PopulationOperations] Inconsistent storage state: counts exist but no per-tile populations. Attempting rebuild...');
        try {
            const rebuildRes = await PopulationState.rebuildVillageMemberships();
            if (rebuildRes && rebuildRes.success && rebuildRes.total > 0) {
                const repaired = await PopulationState.getAllTilePopulations();
                if (repaired && Object.keys(repaired).length > 0) {
                    return {
                        success: true,
                        message: `Using repaired population data (${existingCount} people)`,
                        isExisting: true,
                        ...formatPopData(repaired)
                    };
                }
            }
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.warn('[PopulationOperations] rebuildVillageMemberships failed:', errorMessage);
        }
    }

    return null;
}

async function selectTilesForInitialization(tileIds: number[]): Promise<number[]> {
    // Fetch habitable tiles with cleared lands from Redis
    const habitableFromDb: number[] = [];
    try {
        const tileData: Record<string, string> = await storage.hgetall('tile');
        const landsData: Record<string, string> = await storage.hgetall('tile:lands');

        if (tileData && landsData) {
            for (const [tileId, tileJson] of Object.entries(tileData)) {
                const tile = JSON.parse(tileJson);
                if (tile.is_habitable) {
                    const landsJson = landsData[tileId];
                    if (landsJson) {
                        const lands: Array<{ cleared?: boolean }> = JSON.parse(landsJson);
                        const hasClearedLand = lands.some((land: { cleared?: boolean }) => land.cleared);
                        if (hasClearedLand) {
                            habitableFromDb.push(parseInt(tileId));
                        }
                    }
                }
            }
        }
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error('[PopulationOperations] Failed to get habitable tiles from Redis:', errorMessage);
    }

    let candidateTiles: number[];
    if (Array.isArray(tileIds) && tileIds.length > 0) {
        const filtered = tileIds.filter(id => habitableFromDb.includes(id));
        candidateTiles = filtered.length > 0 ? filtered : tileIds;
        if (serverConfig.verboseLogs && filtered.length === 0) {
            console.log('[PopulationOperations] Using provided tileIds as fallback (habitable tiles not yet cached in storage)');
        }
    } else {
        candidateTiles = habitableFromDb;
    }

    // Apply tile limit
    const tileLimit = process.env.RESTART_TILE_LIMIT;
    let maxTiles = 5;
    if (tileLimit === '0' || tileLimit === 'all') {
        maxTiles = candidateTiles.length;
    } else if (tileLimit && !isNaN(parseInt(tileLimit))) {
        maxTiles = parseInt(tileLimit);
    }

    const shuffled = candidateTiles.sort(() => 0.5 - Math.random());
    const selectedTiles = shuffled.slice(0, maxTiles);
    if (serverConfig.verboseLogs) {
        console.log(`[PopulationOperations] Selected ${selectedTiles.length} tiles for initialization (limit=${maxTiles})`);
    }

    return selectedTiles;
}

function getCurrentDate(calendarService: CalendarService | null): { currentYear: number; currentMonth: number; currentDay: number } {
    let currentDate;
    if (calendarService && typeof calendarService.getCurrentDate === 'function') {
        currentDate = calendarService.getCurrentDate();
    } else {
        const now = new Date();
        currentDate = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
        console.warn('[PopulationOperations] CalendarService not available. Using system date as fallback:', currentDate);
    }
    return {
        currentYear: currentDate.year,
        currentMonth: currentDate.month,
        currentDay: currentDate.day
    };
}

async function runIntegrityCheck(
    pool: Pool,
    selectedTiles: number[],
    tilePopulationTargets: { [tileId: number]: number }
): Promise<void> {
    try {
        const checkRes = await verifyAndRepairIntegrity(pool, selectedTiles, tilePopulationTargets, {
            repair: serverConfig.integrityRepairOnInit
        });
        if (!checkRes.ok) {
            console.warn('[initPop] Integrity check reported problems:', checkRes.details);
            if (serverConfig.integrityFailOnInit) {
                throw new Error('Initialization aborted due to integrity check failures');
            }
        }
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[initPop] Integrity verification failed:', errorMessage);
        if (serverConfig.integrityFailOnInit) {
            throw err;
        }
    }
}

async function persistToPostgres(): Promise<void> {
    try {
        if (serverConfig.savePopulationOnInit) {
            if (serverConfig.verboseLogs) {
                console.log('[initPop] Persisting population to Postgres via savePopulationData()...');
            }
            const saveRes = await savePopulationData();
            if (serverConfig.verboseLogs) console.log('[initPop] savePopulationData result:', saveRes);
        }
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn('[initPop] savePopulationData failed:', errorMessage);
    }
}

async function waitForStorageSync(
    PopulationState: PopulationStateModule,
    selectedTiles: number[]
): Promise<void> {
    try {
        const waitStart = Date.now();
        const MAX_WAIT_MS = 5000;
        const POLL_MS = 200;
        let allFound = false;
        while (Date.now() - waitStart < MAX_WAIT_MS) {
            const current = await PopulationState.getAllTilePopulations();
            const keys = Object.keys(current);
            allFound = selectedTiles.every(tid => keys.includes(String(tid)));
            if (allFound) break;
            await new Promise(resolve => setTimeout(resolve, POLL_MS));
        }
        if (!allFound) {
            console.warn('[initPop] Timeout waiting for all selected tiles to appear in storage.');
        } else if (serverConfig.verboseLogs) {
            console.log('[initPop] All selected tiles detected in storage after', Date.now() - waitStart, 'ms');
        }
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn('[initPop] Error while waiting for selected tiles in storage:', errorMessage);
    }
}

async function getFinalPopulations(
    pool: Pool,
    PopulationState: PopulationStateModule
): Promise<TilePopulations> {
    try {
        return await loadPopData(pool);
    } catch {
        return await PopulationState.getAllTilePopulations();
    }
}

function logMismatches(
    populations: TilePopulations,
    selectedTiles: number[],
    tilePopulationTargets: { [tileId: number]: number }
): void {
    const mismatches: Array<{ tile: number; intended: number; actual: number }> = [];
    for (const tid of selectedTiles) {
        const actual = populations[tid] || 0;
        const intended = tilePopulationTargets[tid];
        if (typeof intended !== 'undefined' && actual !== intended) {
            mismatches.push({ tile: tid, intended, actual });
        }
    }
    if (mismatches.length > 0) {
        console.warn('[initPop] Population mismatches detected:', mismatches.slice(0, 10));
    }
}
