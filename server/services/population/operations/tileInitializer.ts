// Population Operations - Tile Initializer Module
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
import { formatPopData } from './helpers';
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
    _pool: unknown,
    calendarService?: CalendarService | null,
    serviceInstance?: PopulationServiceInstance,
    tileIds?: number[],
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
        const selectedTiles = await selectTilesForInitialization(tileIds ?? []);
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
            // pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE') removed - no longer using Postgres directly
            if (serverConfig.verboseLogs) console.log(`⏱️ [initPop] Clear done in ${Date.now() - startTime}ms`);
        }

        // Get current date
        const { currentYear, currentMonth, currentDay } = getCurrentDate(calendarService ?? null);

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
        await runIntegrityCheck(selectedTiles, tilePopulationTargets);

        // Optionally persist to Postgres
        await persistToPostgres();

        // Wait for storage to reflect all tiles
        await waitForStorageSync(PopulationState, selectedTiles);

        // Return formatted result
        const totalTime = Date.now() - startTime;
        if (serverConfig.verboseLogs) {
            console.log(`✅ [initPop] COMPLETE: ${updatedPeople.length} people, ${allFamilies.length} families in ${totalTime}ms`);
        }

        const populations = await getFinalPopulations(PopulationState);
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

        // Inconsistent state - counts exist but no per-tile populations
        console.warn('[PopulationOperations] Inconsistent storage state: counts exist but no per-tile populations.');
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
                const terrainType = tile.terrain_type || '';
                const biome = tile.biome || '';
                const tileIsHabitable = terrainType !== 'ocean' && terrainType !== 'mountains' &&
                    biome !== 'desert' && biome !== 'tundra' && biome !== 'alpine';
                if (tileIsHabitable) {
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
        // Filter provided tiles against habitableFromDb to ensure only habitable tiles are used
        const filtered = tileIds.filter(id => habitableFromDb.includes(id));
        if (filtered.length > 0) {
            candidateTiles = filtered;
        } else if (habitableFromDb.length > 0) {
            // If provided tiles don't match, use habitable tiles from Redis instead
            console.warn(`[PopulationOperations] Provided ${tileIds.length} tileIds but none are habitable. Using ${habitableFromDb.length} habitable tiles from Redis.`);
            candidateTiles = habitableFromDb;
        } else {
            // No habitable tiles at all - this is an error state
            console.error('[PopulationOperations] No habitable tiles available - cannot initialize population');
            candidateTiles = [];
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
    selectedTiles: number[],
    tilePopulationTargets: { [tileId: number]: number }
): Promise<void> {
    try {
        const checkRes = await verifyAndRepairIntegrity(undefined, selectedTiles, tilePopulationTargets, {
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
    // Note: At this point, people are written to the 'person' hash with residency=tile_id.
    // We verify that people exist in storage by checking total count.
    try {
        const waitStart = Date.now();
        const MAX_WAIT_MS = 3000;
        const POLL_MS = 100;
        let found = false;
        while (Date.now() - waitStart < MAX_WAIT_MS) {
            const totalPop = await PopulationState.getTotalPopulation();
            if (totalPop > 0) {
                found = true;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, POLL_MS));
        }
        if (!found) {
            console.warn('[initPop] Timeout waiting for population count in storage.');
        } else if (serverConfig.verboseLogs) {
            console.log('[initPop] Population data detected in storage after', Date.now() - waitStart, 'ms');
        }
    } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn('[initPop] Error while waiting for storage sync:', errorMessage);
    }
}

async function getFinalPopulations(
    PopulationState: PopulationStateModule
): Promise<TilePopulations> {
    // Count people by tile_id directly from the person hash.
    try {
        const allPeople = await PopulationState.getAllPeople();
        const populations: TilePopulations = {};
        for (const person of allPeople) {
            if (person.tile_id !== null && person.tile_id !== undefined) {
                populations[person.tile_id] = (populations[person.tile_id] || 0) + 1;
            }
        }
        return populations;
    } catch {
        // Fallback to tile population counting
        return await PopulationState.getAllTilePopulations();
    }
}

function logMismatches(
    populations: TilePopulations,
    selectedTiles: number[],
    tilePopulationTargets: { [tileId: number]: number }
): void {
    // Note: At this stage, mismatches are expected if population was trimmed for capacity
    const mismatches: Array<{ tile: number; intended: number; actual: number }> = [];
    for (const tid of selectedTiles) {
        const actual = populations[tid] || 0;
        const intended = tilePopulationTargets[tid];
        // Only log if there's a significant mismatch (actual=0 means something went wrong)
        if (typeof intended !== 'undefined' && actual === 0) {
            mismatches.push({ tile: tid, intended, actual });
        }
    }
    if (mismatches.length > 0) {
        console.warn('[initPop] Population mismatches detected (0 people on tiles):', mismatches.slice(0, 5));
    }
}
