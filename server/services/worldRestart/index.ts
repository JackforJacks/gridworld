/**
 * World Restart Service
 *
 * Unified, Redis-first world restart logic with data integrity guarantees.
 * This is the SINGLE source of truth for all restart operations.
 *
 * Flow:
 * 1. Flush Redis completely (clean slate)
 * 2. Generate new world seed
 * 3. Regenerate tiles from hexasphere
 * 4. Select habitable tiles (with strict validation)
 * 5. Create population on habitable tiles
 * 6. Verify data integrity
 * 7. Broadcast to clients
 */

import storage from '../storage';
import rustSimulation from '../rustSimulation';
import Hexasphere from '../../../src/core/hexasphere/HexaSphere';
import idAllocator from '../idAllocator';
import {
    calculateTileProperties,
    isHabitable,
} from '../terrain';

// ============================================================================
// TYPES
// ============================================================================

export interface WorldRestartOptions {
    /** Use specific seed instead of random */
    seed?: number;
    /** Number of tiles to populate (default: 5) */
    tileCount?: number;
    /** Skip calendar reset */
    skipCalendarReset?: boolean;
    /** Context for calendar/socket operations */
    context?: {
        calendarService?: CalendarService;
        io?: SocketIO;
    };
}

export interface WorldRestartResult {
    success: boolean;
    seed: number;
    tiles: number;
    people: number;
    elapsed: number;
    integrity: IntegrityResult;
    error?: string;
}

interface CalendarService {
    state?: { isRunning?: boolean };
    stop?: () => void;
    start?: () => void;
    setDate?: (day: number, month: number, year: number) => void;
    getState?: () => unknown;
    calculateTotalDays?: (year: number, month: number, day: number) => number;
}

interface SocketIO {
    emit: (event: string, data: unknown) => void;
}

interface Person {
    id: number;
    tile_id: number;
    sex: boolean; // true=male, false=female
    date_of_birth: string;
    family_id: number | null;
}

interface IntegrityResult {
    valid: boolean;
    issues: string[];
    stats: {
        tiles: number;
        habitableTiles: number;
        populatedTiles: number;
        people: number;
    };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const POPULATED_TILE_RATIO = 0.6; // Seed 60% of habitable tiles
const PEOPLE_PER_TILE_MIN = 0;
const PEOPLE_PER_TILE_MAX = 100;
const CALENDAR_START_YEAR = 4000;

// ============================================================================
// SEEDED RANDOM
// ============================================================================

type SeededRandomFn = () => number;

function createSeededRandom(seed: number): SeededRandomFn {
    let s = seed % 2147483647;
    return function (): number {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

// ============================================================================
// MAIN RESTART FUNCTION
// ============================================================================

/**
 * Perform a complete world restart (Redis-first, no Postgres)
 */
export async function restartWorld(options: WorldRestartOptions = {}): Promise<WorldRestartResult> {
    const startTime = Date.now();
    const tileCount = options.tileCount ?? 0; // 0 means use POPULATED_TILE_RATIO (60%)

    // Generate or use provided seed
    const seed = options.seed ?? Math.floor(Math.random() * 2147483647);
    process.env.WORLD_SEED = seed.toString();

    console.log(`🌍 [WorldRestart] Starting world restart with seed: ${seed}`);

    try {
        // Step 1: Pause calendar if running
        const calendarWasRunning = pauseCalendar(options.context?.calendarService);

        // Step 2: Flush Redis completely
        console.log('🔄 [WorldRestart] Step 1/5: Flushing Redis...');
        await flushRedis();

        // Step 3: Reset ID allocators
        console.log('🔢 [WorldRestart] Step 2/5: Resetting ID allocators...');
        await resetIdAllocators();

        // Step 4: Generate tiles from hexasphere
        console.log('🗺️ [WorldRestart] Step 3/5: Generating tiles...');
        const tilesGenerated = await generateTilesFromSeed(seed);

        // Step 5: Select habitable tiles, let Rust decide population counts, then create Redis people
        console.log('👥 [WorldRestart] Step 4/5: Creating population...');
        const { habitableTiles, selectedTiles, people } = await createPopulation(seed, tileCount);
        console.log(`   🦀 Rust ECS seeded: ${rustSimulation.getPopulation()} people across ${selectedTiles.length} tiles`);

        // Step 6: Verify data integrity
        console.log('✅ [WorldRestart] Step 5/5: Verifying integrity...');
        const integrity = await verifyIntegrity();

        // Reset calendar if requested
        if (!options.skipCalendarReset && options.context?.calendarService) {
            resetCalendar(options.context.calendarService);
        }

        // Resume calendar if it was running
        resumeCalendar(options.context?.calendarService, calendarWasRunning);

        // Broadcast to clients
        if (options.context?.io) {
            broadcastRestart(options.context.io, seed);
        }

        const elapsed = Date.now() - startTime;

        console.log(`🎲 [WorldRestart] World restarted with seed: ${seed} (took ${elapsed}ms)`);
        console.log(`   📊 Stats: ${tilesGenerated} tiles, ${habitableTiles} habitable, ${selectedTiles.length} populated, ${people.length} people`);

        if (!integrity.valid) {
            console.warn(`   ⚠️ Integrity issues: ${integrity.issues.join(', ')}`);
        }

        return {
            success: true,
            seed,
            tiles: tilesGenerated,
            people: people.length,
            elapsed,
            integrity
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ [WorldRestart] Failed:`, errorMessage);

        return {
            success: false,
            seed,
            tiles: 0,
            people: 0,
            elapsed: Date.now() - startTime,
            integrity: { valid: false, issues: [errorMessage], stats: { tiles: 0, habitableTiles: 0, populatedTiles: 0, people: 0 } },
            error: errorMessage
        };
    }
}

// ============================================================================
// STEP 1: FLUSH REDIS
// ============================================================================

async function flushRedis(): Promise<void> {
    if (!storage.isAvailable()) {
        throw new Error('Redis storage not available');
    }

    // Try flushdb first
    if (typeof storage.flushdb === 'function') {
        await storage.flushdb();

        // Verify flush succeeded
        if (typeof storage.keys === 'function') {
            const remaining = await storage.keys('*') || [];
            if (remaining.length > 0) {
                console.warn(`⚠️ [WorldRestart] ${remaining.length} keys remain after flushdb, clearing manually...`);
                await clearRemainingKeys(remaining);
            }
        }
    } else {
        // Fallback: delete all known keys
        await clearAllKnownKeys();
    }
}

async function clearRemainingKeys(keys: string[]): Promise<void> {
    const batchSize = 100;
    for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await storage.del(...batch);
    }
}

async function clearAllKnownKeys(): Promise<void> {
    // Delete all known hash keys
    await storage.del(
        'tile', 'tile:fertility', 'tile:populations',
        'person', 'family',
        'counts:global',
        'next:person:id', 'next:family:id'
    );

    // Clear pattern-based keys
    const patterns = [
        'eligible:*:*',
        'pending:*',
        'fertile:*',
        'lock:*',
        'stats:*'
    ];

    for (const pattern of patterns) {
        const stream = storage.scanStream({ match: pattern, count: 1000 });
        const keys: string[] = [];
        for await (const resultKeys of stream) {
            keys.push(...resultKeys);
        }
        if (keys.length > 0) {
            await clearRemainingKeys(keys);
        }
    }
}

// ============================================================================
// STEP 2: RESET ID ALLOCATORS
// ============================================================================

async function resetIdAllocators(): Promise<void> {
    await idAllocator.reset();
}

// ============================================================================
// STEP 3: GENERATE TILES
// ============================================================================

interface TileData {
    id: number;
    center_x: number;
    center_y: number;
    center_z: number;
    latitude: number;
    longitude: number;
    terrain_type: string;
    biome: string | null;
    fertility: number;
    boundary_points: string;
    neighbor_ids: string;
}

export async function generateTilesFromSeed(seed: number): Promise<number> {
    const radius = parseFloat(process.env.HEXASPHERE_RADIUS || '30');
    const subdivisions = parseFloat(process.env.HEXASPHERE_SUBDIVISIONS || '3');
    const tileWidthRatio = parseFloat(process.env.HEXASPHERE_TILE_WIDTH_RATIO || '1');

    // Create hexasphere for geometry only - terrain comes from centralized module
    const hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);
    const pipeline = storage.pipeline();

    let habitableCount = 0;

    for (const tile of hexasphere.tiles) {
        const centerPoint = tile.centerPoint;
        const x = centerPoint?.x || 0;
        const y = centerPoint?.y || 0;
        const z = centerPoint?.z || 0;

        // Get tile ID from hexasphere geometry
        const props = tile.getProperties ? tile.getProperties() : tile;
        const tileId = props.id;

        // Calculate ALL terrain/biome properties from centralized module
        const tileProps = calculateTileProperties(x, y, z, seed);

        if (tileProps.isHabitable) habitableCount++;

        const tileData: TileData = {
            id: tileId,
            center_x: x,
            center_y: y,
            center_z: z,
            latitude: tileProps.latitude,
            longitude: tileProps.longitude,
            terrain_type: tileProps.terrainType,
            biome: tileProps.biome,
            fertility: tileProps.fertility,
            boundary_points: JSON.stringify(tile.boundary?.map((p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.y, z: p.z })) || []),
            neighbor_ids: JSON.stringify(props.neighborIds || [])
        };

        pipeline.hset('tile', tileId.toString(), JSON.stringify(tileData));

        if (tileProps.fertility > 0) {
            pipeline.hset('tile:fertility', tileId.toString(), tileProps.fertility.toString());
        }
    }

    await pipeline.exec();

    console.log(`   Generated ${hexasphere.tiles.length} tiles (${habitableCount} habitable)`);
    return hexasphere.tiles.length;
}

// ============================================================================
// STEP 4: CREATE POPULATION
// ============================================================================

interface PopulationResult {
    habitableTiles: number;
    selectedTiles: number[];
    people: Person[];
    tilePeopleCounts: number[];
}

async function createPopulation(seed: number, tileCount: number): Promise<PopulationResult> {
    // Get all tiles from Redis
    const allTiles = await storage.hgetall('tile');

    if (!allTiles || Object.keys(allTiles).length === 0) {
        throw new Error('No tiles found in Redis after generation');
    }

    // Find habitable tiles
    const habitableTileIds: number[] = [];

    for (const [tileId, tileJson] of Object.entries(allTiles)) {
        const tile = JSON.parse(tileJson);
        if (!isHabitable(tile.terrain_type, tile.biome, tile.terrain_type !== 'ocean')) continue;
        habitableTileIds.push(parseInt(tileId));
    }

    // Warn if no habitable tiles found, but continue with empty population
    if (habitableTileIds.length === 0) {
        console.warn('⚠️ [WorldRestart] No habitable tiles found - world will have no population');
        return { habitableTiles: 0, selectedTiles: [], people: [], tilePeopleCounts: [] };
    }

    // Shuffle and select 60% of habitable tiles (or use explicit tileCount if provided)
    const rng = createSeededRandom(seed);
    const shuffled = [...habitableTileIds].sort(() => rng() - 0.5);
    const targetCount = tileCount > 0
        ? Math.min(tileCount, shuffled.length)
        : Math.floor(shuffled.length * POPULATED_TILE_RATIO);
    const selectedTiles = shuffled.slice(0, targetCount);

    console.log(`   Seeding ${selectedTiles.length} tiles (${Math.round(selectedTiles.length / habitableTileIds.length * 100)}% of ${habitableTileIds.length} habitable)`);

    // Let Rust ECS decide population counts per tile within the configured range
    rustSimulation.reset();
    const tilePeopleCounts: number[] = [];
    let totalPeopleNeeded = 0;

    for (const tileId of selectedTiles) {
        const count = rustSimulation.seedPopulationOnTileRange(PEOPLE_PER_TILE_MIN, PEOPLE_PER_TILE_MAX, tileId);
        tilePeopleCounts.push(count);
        totalPeopleNeeded += count;
    }

    console.log(`   Allocating ${totalPeopleNeeded} person IDs in batch (counts decided by Rust)...`);

    // Batch allocate ALL person IDs in one Redis call
    const allPersonIds = await idAllocator.getPersonIdBatch(totalPeopleNeeded);
    let personIdIndex = 0;

    const PIPELINE_CHUNK_SIZE = 10000; // Chunk Redis pipelines to avoid memory issues

    // Create people on each selected tile, chunking pipelines
    const allPeople: Person[] = [];
    let pipeline = storage.pipeline();
    let pipelineCount = 0;

    for (let tileIndex = 0; tileIndex < selectedTiles.length; tileIndex++) {
        const tileId = selectedTiles[tileIndex];
        const peopleCount = tilePeopleCounts[tileIndex];

        for (let i = 0; i < peopleCount; i++) {
            const personId = allPersonIds[personIdIndex++];
            const isMale = rng() < 0.5; // true=male, false=female
            const age = 18 + Math.floor(rng() * 40); // 18-57 years old
            const birthYear = CALENDAR_START_YEAR - age;
            const birthMonth = 1 + Math.floor(rng() * 12);
            const birthDay = 1 + Math.floor(rng() * 28);

            const person: Person = {
                id: personId,
                tile_id: tileId,
                sex: isMale,
                date_of_birth: `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`,
                family_id: null
            };

            allPeople.push(person);
            pipeline.hset('person', personId.toString(), JSON.stringify(person));

            // Add to eligible sets for matchmaking
            const eligibleSetKey = isMale ? `eligible:males:tile:${tileId}` : `eligible:females:tile:${tileId}`;
            const tilesSetKey = isMale ? 'tiles_with_eligible_males' : 'tiles_with_eligible_females';
            pipeline.sadd(eligibleSetKey, personId.toString());
            pipeline.sadd(tilesSetKey, tileId.toString());
            pipelineCount += 3;

            // Flush pipeline in chunks to avoid memory issues
            if (pipelineCount >= PIPELINE_CHUNK_SIZE) {
                await pipeline.exec();
                pipeline = storage.pipeline();
                pipelineCount = 0;
            }
        }
    }

    // Flush remaining pipeline commands
    if (pipelineCount > 0) {
        await pipeline.exec();
    }

    console.log(`   Created ${allPeople.length} people on ${selectedTiles.length} tiles`);

    return {
        habitableTiles: habitableTileIds.length,
        selectedTiles,
        people: allPeople,
        tilePeopleCounts
    };
}

// ============================================================================
// STEP 5: VERIFY INTEGRITY
// ============================================================================

async function verifyIntegrity(): Promise<IntegrityResult> {
    const issues: string[] = [];

    // Get all data
    const tiles = await storage.hgetall('tile');
    const people = await storage.hgetall('person');

    const tileCount = Object.keys(tiles || {}).length;
    const personCount = Object.keys(people || {}).length;

    // Count habitable tiles
    let habitableCount = 0;
    const populatedTileIds = new Set<number>();

    for (const tileJson of Object.values(tiles || {})) {
        const tile = JSON.parse(tileJson);
        if (isHabitable(tile.terrain_type, tile.biome, tile.terrain_type !== 'ocean')) habitableCount++;
    }

    // Check people integrity
    for (const personJson of Object.values(people || {})) {
        const person = JSON.parse(personJson);

        if (person.tile_id) {
            populatedTileIds.add(person.tile_id);
        }

        // Verify person is on habitable tile
        if (person.tile_id && tiles) {
            const tileJson = tiles[person.tile_id.toString()];
            if (tileJson) {
                const tile = JSON.parse(tileJson);
                if (!isHabitable(tile.terrain_type, tile.biome, tile.terrain_type !== 'ocean')) {
                    issues.push(`Person ${person.id} is on uninhabitable tile ${person.tile_id} (${tile.terrain_type})`);
                }
            }
        }
    }

    return {
        valid: issues.length === 0,
        issues,
        stats: {
            tiles: tileCount,
            habitableTiles: habitableCount,
            populatedTiles: populatedTileIds.size,
            people: personCount,
        }
    };
}

// ============================================================================
// CALENDAR HELPERS
// ============================================================================

function pauseCalendar(calendarService?: CalendarService): boolean {
    if (calendarService?.state?.isRunning) {
        calendarService.stop?.();
        return true;
    }
    return false;
}

function resumeCalendar(calendarService?: CalendarService, wasRunning?: boolean): void {
    if (wasRunning && calendarService?.start) {
        calendarService.start();
    }
}

function resetCalendar(calendarService: CalendarService): void {
    if (calendarService.setDate) {
        calendarService.setDate(1, 1, CALENDAR_START_YEAR);

        if (calendarService.state) {
            const state = calendarService.state as Record<string, unknown>;
            if (calendarService.calculateTotalDays) {
                state.totalDays = calendarService.calculateTotalDays(CALENDAR_START_YEAR, 1, 1);
            } else {
                state.totalDays = 0;
            }
            state.totalTicks = 0;
            state.startTime = Date.now();
            state.lastTickTime = Date.now();
        }
    }
}

// ============================================================================
// BROADCAST HELPERS
// ============================================================================

function broadcastRestart(io: SocketIO, seed: number): void {
    io.emit('worldRestarted', { seed });
    io.emit('populationReset', {});
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    restartWorld,
    generateTilesFromSeed
};
