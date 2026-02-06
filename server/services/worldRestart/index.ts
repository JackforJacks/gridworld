/**
 * World Restart Service
 * 
 * Unified, Redis-first world restart logic with data integrity guarantees.
 * This is the SINGLE source of truth for all restart operations.
 * 
 * Postgres is NEVER touched during restart - only on explicit save/load/autosave.
 * 
 * Flow:
 * 1. Flush Redis completely (clean slate)
 * 2. Generate new world seed
 * 3. Regenerate tiles from hexasphere
 * 4. Select habitable tiles (with strict validation)
 * 5. Create population on habitable tiles
 * 6. Create villages for populated tiles
 * 7. Verify data integrity
 * 8. Broadcast to clients
 */

import storage from '../storage';
import rustSimulation from '../rustSimulation';
import Hexasphere from '../../../src/core/hexasphere/HexaSphere';
import idAllocator from '../idAllocator';
import {
    calculateTileProperties,
    generateLandsForTile,
    isHabitable,
    UNINHABITABLE_TERRAIN,
    UNINHABITABLE_BIOMES,
    type LandChunk,
    type TileProperties
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
    villages: number;
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

interface StoredTileData {
    id: number;
    center_x: number;
    center_y: number;
    center_z: number;
    latitude: number;
    longitude: number;
    terrain_type: string;
    is_land: boolean;
    is_habitable: boolean;
    biome: string | null;
    fertility: number;
    boundary_points: string;
    neighbor_ids: string;
}

interface Person {
    id: number;
    tile_id: number;
    sex: boolean; // true=male, false=female
    date_of_birth: string;
    residency: number | null;
    family_id: number | null;
}

interface Village {
    id: number;
    tile_id: number;
    land_chunk_index: number;
    name: string;
    housing_capacity: number;
    food_stores: number;
    food_capacity: number;
    food_production_rate: number;
}

interface IntegrityResult {
    valid: boolean;
    issues: string[];
    stats: {
        tiles: number;
        habitableTiles: number;
        populatedTiles: number;
        people: number;
        villages: number;
        peopleWithResidency: number;
        orphanedPeople: number;
    };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const POPULATED_TILE_RATIO = 0.6; // Seed 60% of habitable tiles
const PEOPLE_PER_TILE_MIN = 0;
const PEOPLE_PER_TILE_MAX = 100;
const CALENDAR_START_YEAR = 4000;

// Village names pool
const VILLAGE_NAMES = [
    'Willowbrook', 'Stonehaven', 'Oakridge', 'Riverdale', 'Meadowvale',
    'Pinewood', 'Sunfield', 'Clearwater', 'Hillcrest', 'Greendale',
    'Fairview', 'Lakeside', 'Woodhaven', 'Northgate', 'Westbrook',
    'Eastholm', 'Southdale', 'Ironforge', 'Goldleaf', 'Silverbrook',
    'Redmont', 'Bluehaven', 'Greenmoor', 'Whitepeak', 'Blackwood',
    'Thornhill', 'Ashford', 'Birchwood', 'Cedarfall', 'Elmgrove'
];

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

function mulberry32(seed: number): SeededRandomFn {
    let s = seed;
    return function (): number {
        let t = s += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
        console.log('🔄 [WorldRestart] Step 1/6: Flushing Redis...');
        await flushRedis();

        // Step 3: Reset ID allocators
        console.log('🔢 [WorldRestart] Step 2/6: Resetting ID allocators...');
        await resetIdAllocators();

        // Step 4: Generate tiles from hexasphere
        console.log('🗺️ [WorldRestart] Step 3/6: Generating tiles...');
        const tilesGenerated = await generateTiles(seed);

        // Step 5: Select habitable tiles and create population
        console.log('👥 [WorldRestart] Step 4/6: Creating population...');
        const { habitableTiles, selectedTiles, people, tilePeopleCounts } = await createPopulation(seed, tileCount);

        // Step 5b: Seed Rust ECS simulation with same tile/population data
        console.log('🦀 [WorldRestart] Seeding Rust simulation...');
        rustSimulation.reset();
        for (let i = 0; i < selectedTiles.length; i++) {
            if (tilePeopleCounts[i] > 0) {
                rustSimulation.seedPopulationOnTile(tilePeopleCounts[i], selectedTiles[i]);
            }
        }
        console.log(`   🦀 Rust ECS seeded: ${rustSimulation.getPopulation()} people across ${selectedTiles.length} tiles`);

        // Step 6: Create villages for populated tiles
        console.log('🏘️ [WorldRestart] Step 5/6: Creating villages...');
        const villages = await createVillages(selectedTiles, people);

        // Step 7: Verify data integrity
        console.log('✅ [WorldRestart] Step 6/6: Verifying integrity...');
        const integrity = await verifyIntegrity();

        // Reset calendar if requested
        if (!options.skipCalendarReset && options.context?.calendarService) {
            resetCalendar(options.context.calendarService);
        }

        // Resume calendar if it was running
        resumeCalendar(options.context?.calendarService, calendarWasRunning);

        // Broadcast to clients
        if (options.context?.io) {
            broadcastRestart(options.context.io, villages, seed);
        }

        const elapsed = Date.now() - startTime;

        console.log(`🎲 [WorldRestart] World restarted with seed: ${seed} (took ${elapsed}ms)`);
        console.log(`   📊 Stats: ${tilesGenerated} tiles, ${habitableTiles} habitable, ${selectedTiles.length} populated, ${people.length} people, ${villages.length} villages`);

        if (!integrity.valid) {
            console.warn(`   ⚠️ Integrity issues: ${integrity.issues.join(', ')}`);
        }

        return {
            success: true,
            seed,
            tiles: tilesGenerated,
            people: people.length,
            villages: villages.length,
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
            villages: 0,
            elapsed: Date.now() - startTime,
            integrity: { valid: false, issues: [errorMessage], stats: { tiles: 0, habitableTiles: 0, populatedTiles: 0, people: 0, villages: 0, peopleWithResidency: 0, orphanedPeople: 0 } },
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
        'tile', 'tile:lands', 'tile:fertility', 'tile:populations',
        'village', 'village:cleared',
        'person', 'family',
        'counts:global',
        'next:person:id', 'next:family:id', 'next:village:id'
    );

    // Clear pattern-based keys
    const patterns = [
        'village:*:*:people',
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
    is_land: boolean;
    is_habitable: boolean;
    biome: string | null;
    fertility: number;
    boundary_points: string;
    neighbor_ids: string;
}

async function generateTiles(seed: number): Promise<number> {
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
        // This ensures consistency across the entire codebase
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
            is_land: tileProps.isLand,
            is_habitable: tileProps.isHabitable,
            biome: tileProps.biome,
            fertility: tileProps.fertility,
            boundary_points: JSON.stringify(tile.boundary?.map((p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.y, z: p.z })) || []),
            neighbor_ids: JSON.stringify(props.neighborIds || [])
        };

        pipeline.hset('tile', tileId.toString(), JSON.stringify(tileData));

        if (tileProps.fertility > 0) {
            pipeline.hset('tile:fertility', tileId.toString(), tileProps.fertility.toString());
        }

        // Generate lands for habitable tiles
        if (tileProps.isHabitable) {
            const lands = generateLandsForTile(tileId, seed);
            pipeline.hset('tile:lands', tileId.toString(), JSON.stringify(lands));
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
    const allLands = await storage.hgetall('tile:lands');

    if (!allTiles || Object.keys(allTiles).length === 0) {
        throw new Error('No tiles found in Redis after generation');
    }

    // Find habitable tiles with cleared lands
    const habitableTileIds: number[] = [];

    for (const [tileId, tileJson] of Object.entries(allTiles)) {
        const tile = JSON.parse(tileJson);

        // Double-check habitability (defensive programming)
        if (!tile.is_habitable) continue;
        if (UNINHABITABLE_TERRAIN.includes(tile.terrain_type)) continue;
        if (tile.biome && UNINHABITABLE_BIOMES.includes(tile.biome)) continue;

        // Check for cleared lands
        const landsJson = allLands[tileId];
        if (!landsJson) continue;

        const lands = JSON.parse(landsJson);
        const hasClearedLand = lands.some((l: LandChunk) => l.cleared);
        if (!hasClearedLand) continue;

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

    console.log(`   Selected ${selectedTiles.length} tiles from ${habitableTileIds.length} habitable`);

    // Pre-calculate total people needed for batch ID allocation
    const tilePeopleCounts: number[] = [];
    let totalPeopleNeeded = 0;

    for (const _tileId of selectedTiles) {
        const peopleCount = PEOPLE_PER_TILE_MIN + Math.floor(rng() * (PEOPLE_PER_TILE_MAX - PEOPLE_PER_TILE_MIN));
        tilePeopleCounts.push(peopleCount);
        totalPeopleNeeded += peopleCount;
    }

    console.log(`   Allocating ${totalPeopleNeeded} person IDs in batch...`);

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
                residency: null,
                family_id: null
            };

            allPeople.push(person);
            pipeline.hset('person', personId.toString(), JSON.stringify(person));
            
            // Add to eligible sets for matchmaking (all new adults without families are eligible)
            const eligibleSetKey = isMale ? `eligible:males:tile:${tileId}` : `eligible:females:tile:${tileId}`;
            const tilesSetKey = isMale ? 'tiles_with_eligible_males' : 'tiles_with_eligible_females';
            pipeline.sadd(eligibleSetKey, personId.toString());
            pipeline.sadd(tilesSetKey, tileId.toString());
            pipelineCount += 3; // Count all 3 commands

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

    // DEBUG: Verify a sample of eligible sets are correctly populated
    const sampleTile = selectedTiles[0];
    const maleSetMembers = await storage.smembers(`eligible:males:tile:${sampleTile}`) || [];
    const femaleSetMembers = await storage.smembers(`eligible:females:tile:${sampleTile}`) || [];
    
    if (maleSetMembers.length > 0) {
        const sampleMaleJson = await storage.hget('person', maleSetMembers[0]);
        if (sampleMaleJson) {
            const sampleMale = JSON.parse(sampleMaleJson);
            console.log(`   [WorldRestart] Verify males set: person ${maleSetMembers[0]} has sex=${sampleMale.sex} (expected: true)`);
        }
    }
    if (femaleSetMembers.length > 0) {
        const sampleFemaleJson = await storage.hget('person', femaleSetMembers[0]);
        if (sampleFemaleJson) {
            const sampleFemale = JSON.parse(sampleFemaleJson);
            console.log(`   [WorldRestart] Verify females set: person ${femaleSetMembers[0]} has sex=${sampleFemale.sex} (expected: false)`);
        }
    }
    console.log(`   [WorldRestart] Tile ${sampleTile}: ${maleSetMembers.length} in males set, ${femaleSetMembers.length} in females set`);

    console.log(`   Created ${allPeople.length} people on ${selectedTiles.length} tiles (added to eligible sets)`);

    return {
        habitableTiles: habitableTileIds.length,
        selectedTiles,
        people: allPeople,
        tilePeopleCounts
    };
}

// ============================================================================
// STEP 5: CREATE VILLAGES
// ============================================================================

async function createVillages(selectedTiles: number[], people: Person[]): Promise<Village[]> {
    // Group people by tile
    const peopleByTile = new Map<number, Person[]>();
    for (const person of people) {
        const tileId = person.tile_id;
        if (!peopleByTile.has(tileId)) {
            peopleByTile.set(tileId, []);
        }
        peopleByTile.get(tileId)!.push(person);
    }

    // Pre-fetch all lands data in one call
    const allLands = await storage.hgetall('tile:lands');

    // Pre-determine how many villages we need (tiles with people and cleared lands)
    const tilesNeedingVillages: number[] = [];
    for (const tileId of selectedTiles) {
        const tilePeople = peopleByTile.get(tileId) || [];
        if (tilePeople.length === 0) continue;

        const landsJson = allLands[tileId.toString()];
        if (!landsJson) continue;

        const lands: LandChunk[] = JSON.parse(landsJson);
        if (lands.some(l => l.cleared)) {
            tilesNeedingVillages.push(tileId);
        }
    }

    // Batch allocate all village IDs
    const villageIds = await idAllocator.getVillageIdBatch(tilesNeedingVillages.length);

    const PIPELINE_CHUNK_SIZE = 10000;
    const villages: Village[] = [];
    let pipeline = storage.pipeline();
    let pipelineCount = 0;
    let nameIndex = 0;
    let villageIdIndex = 0;

    for (const tileId of tilesNeedingVillages) {
        const tilePeople = peopleByTile.get(tileId) || [];
        const landsJson = allLands[tileId.toString()];
        const lands: LandChunk[] = JSON.parse(landsJson);
        const clearedChunks = lands.filter(l => l.cleared).map(l => l.chunk_index);

        // Create one village per tile (on first cleared chunk)
        const villageId = villageIds[villageIdIndex++];
        const chunkIndex = clearedChunks[0];
        const villageName = VILLAGE_NAMES[nameIndex % VILLAGE_NAMES.length];
        nameIndex++;

        const village: Village = {
            id: villageId,
            tile_id: tileId,
            land_chunk_index: chunkIndex,
            name: villageName,
            housing_capacity: 1000,
            food_stores: 10000,
            food_capacity: 50000,
            food_production_rate: 100
        };

        villages.push(village);
        pipeline.hset('village', villageId.toString(), JSON.stringify(village));
        pipelineCount++;

        // Assign all people on this tile to this village
        const membershipKey = `village:${tileId}:${chunkIndex}:people`;
        for (const person of tilePeople) {
            person.residency = villageId;
            pipeline.hset('person', person.id.toString(), JSON.stringify(person));
            pipeline.sadd(membershipKey, person.id.toString());
            pipelineCount += 2;

            // Flush pipeline in chunks
            if (pipelineCount >= PIPELINE_CHUNK_SIZE) {
                await pipeline.exec();
                pipeline = storage.pipeline();
                pipelineCount = 0;
            }
        }
    }

    // Flush remaining
    if (pipelineCount > 0) {
        await pipeline.exec();
    }

    console.log(`   Created ${villages.length} villages with ${people.length} residents`);

    return villages;
}

// ============================================================================
// STEP 6: VERIFY INTEGRITY
// ============================================================================

async function verifyIntegrity(): Promise<IntegrityResult> {
    const issues: string[] = [];

    // Get all data
    const tiles = await storage.hgetall('tile');
    const people = await storage.hgetall('person');
    const villages = await storage.hgetall('village');

    const tileCount = Object.keys(tiles || {}).length;
    const personCount = Object.keys(people || {}).length;
    const villageCount = Object.keys(villages || {}).length;

    // Count habitable tiles
    let habitableCount = 0;
    const populatedTileIds = new Set<number>();

    for (const tileJson of Object.values(tiles || {})) {
        const tile = JSON.parse(tileJson);
        if (tile.is_habitable) habitableCount++;
    }

    // Check people integrity
    let peopleWithResidency = 0;
    let orphanedPeople = 0;

    for (const personJson of Object.values(people || {})) {
        const person = JSON.parse(personJson);

        if (person.tile_id) {
            populatedTileIds.add(person.tile_id);
        }

        if (person.residency) {
            peopleWithResidency++;

            // Verify village exists
            if (villages && !villages[person.residency.toString()]) {
                issues.push(`Person ${person.id} has residency ${person.residency} but village doesn't exist`);
                orphanedPeople++;
            }
        } else {
            orphanedPeople++;
        }

        // Verify person is on habitable tile
        if (person.tile_id && tiles) {
            const tileJson = tiles[person.tile_id.toString()];
            if (tileJson) {
                const tile = JSON.parse(tileJson);
                if (!tile.is_habitable) {
                    issues.push(`Person ${person.id} is on uninhabitable tile ${person.tile_id} (${tile.terrain_type})`);
                }
            }
        }
    }

    // Check village integrity
    for (const [villageId, villageJson] of Object.entries(villages || {})) {
        const village = JSON.parse(villageJson);

        // Verify village is on habitable tile
        if (tiles) {
            const tileJson = tiles[village.tile_id?.toString()];
            if (tileJson) {
                const tile = JSON.parse(tileJson);
                if (!tile.is_habitable) {
                    issues.push(`Village ${villageId} is on uninhabitable tile ${village.tile_id} (${tile.terrain_type})`);
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
            villages: villageCount,
            peopleWithResidency,
            orphanedPeople
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

function broadcastRestart(io: SocketIO, villages: Village[], seed: number): void {
    io.emit('worldRestarted', { seed, villages: villages.length });
    io.emit('villagesUpdated', villages);
    io.emit('populationReset', {});
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    restartWorld
};
