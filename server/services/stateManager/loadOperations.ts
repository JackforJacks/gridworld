/**
 * State Manager - Load Operations
 * Handles loading state from PostgreSQL into storage on server start
 */

import storage from '../storage';
import pool from '../../config/database';
import { Server as SocketIOServer } from 'socket.io';

// ========== Type Definitions ==========

/** Calendar date structure */
interface CalendarDate {
    year: number;
    month: number;
    day: number;
}

/** Calendar service state */
interface CalendarState {
    isRunning: boolean;
    currentDate?: CalendarDate;
}

/** Calendar service interface */
interface CalendarService {
    state?: CalendarState;
    start: () => void;
    stop: () => void;
    getState?: () => CalendarState;
    loadStateFromDB?: () => Promise<void>;
}

/** Load context passed to loadFromDatabase */
interface LoadContext {
    calendarService?: CalendarService;
    io?: SocketIOServer;
}

/** Result from loading or seeding */
interface LoadResult {
    villages: number;
    people: number;
    families: number;
    male?: number;
    female?: number;
    tiles?: number;
    tilesLands?: number;
    skipped?: boolean;
    seeded?: boolean;
}

/** Result from seedWorldIfEmpty */
interface SeedWorldResult {
    seeded: boolean;
    people: number;
    villages: number;
    tiles?: number;
}

/** Pipeline interface (subset of ioredis ChainableCommander) */
interface Pipeline {
    hset(key: string, field: string, value: string): Pipeline;
    sadd(key: string, member: string): Pipeline;
    exec(): Promise<unknown[]>;
}

/** Tile row from database */
interface TileRow {
    id: number;
    center_x: number;
    center_y: number;
    center_z: number;
    latitude: number;
    longitude: number;
    terrain_type: string;
    is_land: boolean;
    is_habitable: boolean;
    boundary_points: unknown;
    neighbor_ids: number[];
    biome: string | null;
    fertility: number | null;
}

/** Land row from database */
interface LandRow {
    tile_id: number;
    chunk_index: number;
    land_type: string;
    cleared: boolean;
    owner_id: number | null;
    village_id: number | null;
}

/** Village row from database */
interface VillageRow {
    id: number;
    tile_id: number;
    land_chunk_index: number;
    name: string;
    food_stores: string | number;
    food_capacity: string | number;
    food_production_rate: string | number;
    housing_capacity: string | number;
    housing_slots: number[] | string | null;
}

/** Person row from database */
interface PersonRow {
    id: number;
    tile_id: number | null;
    residency: number | null;
    sex: boolean | string | number;
    health: number | null;
    family_id: number | null;
    date_of_birth: string;
}

/** Family row from database */
interface FamilyRow {
    id: number;
    husband_id: number | null;
    wife_id: number | null;
    tile_id: number;
    pregnancy: boolean | null;
    delivery_date: string | null;
    children_ids: number[] | null;
}

/** People load result */
interface LoadPeopleResult {
    people: PersonRow[];
    maleCount: number;
    femaleCount: number;
}

/** Land count row from query */
interface LandCountRow {
    village_id: number;
    cleared_cnt: string;
}

/** Lands grouped by tile */
interface LandsByTile {
    [tileId: string]: Array<{
        tile_id: number;
        chunk_index: number;
        land_type: string;
        cleared: boolean;
        owner_id: number | null;
        village_id: number | null;
    }>;
}

/** People lookup by ID */
interface PeopleMap {
    [id: number]: PersonRow;
}

/** Village ID lookup by tile:chunk key */
interface VillageIdLookup {
    [key: string]: number;
}

/** Validation issue from VillageManager */
interface ValidationIssue {
    type: string;
    tileId: number;
}

/**
 * Load all data from PostgreSQL into storage on server start
 * @param context - StateManager context with calendarService, io
 * @returns Load results
 */
async function loadFromDatabase(context: LoadContext): Promise<LoadResult> {
    if (!storage.isAvailable()) {
        console.warn('⚠️ storage not available, skipping state load');
        return { villages: 0, people: 0, families: 0, skipped: true };
    }

    // Redis-first mode: do not touch Postgres or flush Redis. If Redis already has data, keep it.
    if (process.env.REDIS_FIRST === 'true') {
        console.log('[StateManager] REDIS_FIRST=true, skipping Postgres load and Redis flush');

        // Resume calendar if we paused it earlier
        let calendarWasRunning = false;
        if (context.calendarService && context.calendarService.state) {
            calendarWasRunning = context.calendarService.state.isRunning;
        }
        if (calendarWasRunning && context.calendarService && typeof context.calendarService.start === 'function') {
            context.calendarService.start();
        }

        // Return current Redis counts for visibility
        const villageCount = typeof storage.hlen === 'function' ? await storage.hlen('village') : 0;
        const personCount = typeof storage.hlen === 'function' ? await storage.hlen('person') : 0;
        const familyCount = typeof storage.hlen === 'function' ? await storage.hlen('family') : 0;
        return { villages: villageCount, people: personCount, families: familyCount, skipped: true };
    }

    // Stop calendar during loading to prevent time progression
    let calendarWasRunning = false;
    if (context.calendarService && typeof context.calendarService.stop === 'function') {
        calendarWasRunning = context.calendarService.state?.isRunning ?? false;
        if (calendarWasRunning) {
            context.calendarService.stop();
            console.log('⏸️ Calendar paused during world loading');
        }
    }

    // Reload calendar state from database
    if (context.calendarService && typeof context.calendarService.loadStateFromDB === 'function') {
        await context.calendarService.loadStateFromDB();
    }

    // Clear existing storage state keys to avoid stale data
    await clearExistingStorageState();

    const startTime = Date.now();
    const pipeline = storage.pipeline();

    // Load tiles from Postgres into Redis
    const tiles = await loadTiles(pipeline);

    // Load tiles_lands from Postgres into Redis
    const tilesLands = await loadTilesLands(pipeline);

    // Load villages
    const villages = await loadVillages(pipeline);

    // Load people and count demographics
    const { people, maleCount, femaleCount } = await loadPeople(pipeline);

    // Load families
    const families = await loadFamilies(pipeline);

    const loadEndTime = Date.now();
    const loadDuration = ((loadEndTime - startTime) / 1000).toFixed(2);
    console.log(`📦 Loaded from Postgres: ${people.length} people, ${villages.length} villages, ${families.length} families (${loadDuration}s)`);

    // Populate fertile family candidates
    await populateFertileFamilies(families, people, context.calendarService);

    // Load cleared land counts
    await loadClearedLandCounts(pipeline);

    // Set global population counts
    pipeline.hset('counts:global', 'total', people.length.toString());
    pipeline.hset('counts:global', 'male', maleCount.toString());
    pipeline.hset('counts:global', 'female', femaleCount.toString());
    pipeline.hset('counts:global', 'nextTempId', '-1');
    pipeline.hset('counts:global', 'nextFamilyTempId', '-1');

    await pipeline.exec();

    // Populate eligible matchmaking sets
    await populateEligibleSets(people, context.calendarService);

    // Use robust VillageManager to ensure villages exist and are consistent
    const VillageManager = require('../villageSeeder/villageManager');

    if (people.length > 0) {
        // Validate village consistency
        const validation = await VillageManager.validateVillageConsistency();

        if (!validation.valid) {
            console.warn(`[StateManager] ⚠️ Village consistency issues detected: ${validation.issues.length} issues`);
            for (const issue of validation.issues.slice(0, 5)) {
                console.warn(`[StateManager]   - ${issue.type}: tile ${issue.tileId}`);
            }

            // Auto-repair: ensure villages for all populated tiles
            const repairResult = await VillageManager.ensureVillagesForPopulatedTiles({ force: true });
            if (repairResult.success) {
                console.log(`[StateManager] ✅ Village repair complete: ${repairResult.created} created, ${repairResult.assigned} assigned`);
            } else {
                console.error(`[StateManager] ❌ Village repair failed: ${repairResult.error}`);
            }
        } else {
            // Still rebuild membership sets to ensure they're correct
            try {
                const PeopleState = require('../populationState/PeopleState').default;
                await PeopleState.rebuildVillageMemberships();
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                console.warn('[StateManager] Failed to rebuild village memberships:', errMsg);
            }
        }
    }

    // If Redis is empty after loading from Postgres, seed a new world
    let seedResult: SeedWorldResult | null = null;
    if (people.length === 0) {
        console.log('[StateManager] No people loaded from Postgres, seeding new world...');
        const { seedWorldIfEmpty } = require('../villageSeeder/redisSeeding') as { seedWorldIfEmpty: () => Promise<SeedWorldResult> };
        seedResult = await seedWorldIfEmpty();

        // If seeding happened, also run village manager to ensure everything is consistent
        if (seedResult && seedResult.seeded) {
            await VillageManager.ensureVillagesForPopulatedTiles({ force: false });
        }
    }

    // Restart calendar if it was running before loading
    if (calendarWasRunning && context.calendarService && typeof context.calendarService.start === 'function') {
        context.calendarService.start();
        console.log('▶️ Calendar resumed after world loading');
    }

    // Return loaded counts, or seeded counts if we seeded
    if (seedResult && seedResult.seeded) {
        return {
            villages: seedResult.villages,
            people: seedResult.people,
            families: 0,
            male: 0,
            female: 0,
            tiles: seedResult.tiles,
            tilesLands: 0,
            seeded: true
        };
    }

    return {
        villages: villages.length,
        people: people.length,
        families: families.length,
        male: maleCount,
        female: femaleCount,
        tiles: tiles.length,
        tilesLands: tilesLands
    };
}

async function clearExistingStorageState(): Promise<void> {
    try {
        // Flush the entire Redis database to ensure clean state (guard when not supported)
        if (typeof storage.flushdb === 'function') {
            await storage.flushdb();
        } else {
            throw new Error('flushdb not supported');
        }

        // Check what keys exist after flush (guard for tests/mocks that don't implement it)
        let keysAfter = [];
        if (typeof storage.keys === 'function') {
            keysAfter = await storage.keys('*') || [];
        }

        if (keysAfter.length > 0) {
            console.warn(`⚠️ WARNING: ${keysAfter.length} keys still exist after flushdb! Keys: ${keysAfter.slice(0, 10).join(', ')}${keysAfter.length > 10 ? '...' : ''}`);
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to flush Redis database:', errMsg);
        // Fallback to comprehensive selective clearing
        try {
            // Clear all known hash keys
            await storage.del(
                'village', 'person', 'family',
                'tile', 'tile:lands', 'tile:fertility',
                'village:cleared', 'counts:global'
            );

            // Clear all pattern-based keys using scanStream
            const patterns = [
                'village:*:*:people',   // Village population sets
                'eligible:*:*',         // Eligible matchmaking sets
                'pending:*',            // All pending operations
                'fertile:*',            // Fertile family sets
                'lock:*',               // Any stale locks
                'stats:*'               // Statistics counters
            ];

            for (const pattern of patterns) {
                try {
                    const stream = storage.scanStream({ match: pattern, count: 1000 });
                    const keysToDelete: string[] = [];
                    for await (const resultKeys of stream) {
                        for (const key of resultKeys) keysToDelete.push(key);
                    }
                    if (keysToDelete.length > 0) {
                        // Delete in batches of 100 to avoid overwhelming Redis
                        for (let i = 0; i < keysToDelete.length; i += 100) {
                            const batch = keysToDelete.slice(i, i + 100);
                            await storage.del(...batch);
                        }
                        console.log(`🧹 Cleared ${keysToDelete.length} keys matching '${pattern}'`);
                    }
                } catch (scanErr: unknown) {
                    const scanErrMsg = scanErr instanceof Error ? scanErr.message : String(scanErr);
                    console.warn(`⚠️ Failed to clear keys matching '${pattern}':`, scanErrMsg);
                }
            }

            console.log('🧹 Cleared existing storage state keys (fallback method)');
        } catch (e2: unknown) {
            const e2Msg = e2 instanceof Error ? e2.message : String(e2);
            console.warn('⚠️ Failed to clear storage keys even with fallback:', e2Msg);
        }
    }
}

/**
 * Load tiles from PostgreSQL into storage pipeline
 */
async function loadTiles(pipeline: Pipeline): Promise<TileRow[]> {
    const { rows: tiles } = await pool.query<TileRow>('SELECT * FROM tiles');
    for (const t of tiles) {
        pipeline.hset('tile', t.id.toString(), JSON.stringify({
            id: t.id,
            center_x: t.center_x,
            center_y: t.center_y,
            center_z: t.center_z,
            latitude: t.latitude,
            longitude: t.longitude,
            terrain_type: t.terrain_type,
            is_land: t.is_land,
            is_habitable: t.is_habitable,
            boundary_points: t.boundary_points,
            neighbor_ids: t.neighbor_ids,
            biome: t.biome,
            fertility: t.fertility
        }));
        if (t.fertility !== null) {
            pipeline.hset('tile:fertility', t.id.toString(), t.fertility.toString());
        }
    }
    return tiles;
}

/**
 * Load tiles_lands from PostgreSQL into storage pipeline (grouped by tile_id)
 */
async function loadTilesLands(pipeline: Pipeline): Promise<number> {
    const { rows: lands } = await pool.query<LandRow>('SELECT * FROM tiles_lands ORDER BY tile_id, chunk_index');

    // Group lands by tile_id
    const landsByTile: LandsByTile = {};
    for (const land of lands) {
        const tileId = land.tile_id.toString();
        if (!landsByTile[tileId]) landsByTile[tileId] = [];
        landsByTile[tileId].push({
            tile_id: land.tile_id,
            chunk_index: land.chunk_index,
            land_type: land.land_type,
            cleared: land.cleared,
            owner_id: land.owner_id,
            village_id: land.village_id
        });
    }

    // Store grouped lands in Redis
    for (const [tileId, tileLands] of Object.entries(landsByTile)) {
        pipeline.hset('tile:lands', tileId, JSON.stringify(tileLands));
    }

    return lands.length;
}

/**
 * Load villages from PostgreSQL into storage pipeline
 */
async function loadVillages(pipeline: Pipeline): Promise<VillageRow[]> {
    const { rows: villages } = await pool.query<VillageRow>('SELECT * FROM villages');
    for (const v of villages) {
        let housingSlots: number[] = [];
        try {
            if (Array.isArray(v.housing_slots)) {
                housingSlots = v.housing_slots;
            } else if (v.housing_slots) {
                housingSlots = JSON.parse(v.housing_slots as string);
                if (!Array.isArray(housingSlots)) housingSlots = [];
            }
        } catch (_: unknown) {
            housingSlots = [];
        }

        pipeline.hset('village', v.id.toString(), JSON.stringify({
            id: v.id,
            tile_id: v.tile_id,
            land_chunk_index: v.land_chunk_index,
            name: v.name,
            food_stores: (parseFloat(String(v.food_stores)) || 0),
            food_capacity: parseInt(String(v.food_capacity)) || 1000,
            food_production_rate: (parseFloat(String(v.food_production_rate)) || 0),
            housing_capacity: parseInt(String(v.housing_capacity)) || 100,
            housing_slots: housingSlots,
        }));
    }
    return villages;
}

/**
 * Load people from PostgreSQL into storage pipeline
 */
async function loadPeople(pipeline: Pipeline): Promise<LoadPeopleResult> {
    // First, load villages to build a lookup map: (tile_id, land_chunk_index) -> village_id
    const { rows: villageRows } = await pool.query<{ id: number; tile_id: number; land_chunk_index: number }>('SELECT id, tile_id, land_chunk_index FROM villages');
    const villageIdLookup: VillageIdLookup = {};
    for (const v of villageRows) {
        villageIdLookup[`${v.tile_id}:${v.land_chunk_index}`] = v.id;
    }

    const { rows: people } = await pool.query<PersonRow>('SELECT * FROM people');
    let maleCount = 0, femaleCount = 0;

    for (const p of people) {
        // Normalize sex to boolean
        const sex = p.sex === true || p.sex === 'true' || p.sex === 1 ? true : false;

        // Compute village_id from tile_id and residency (land_chunk_index)
        let villageId: number | null = null;
        if (p.tile_id !== null && p.residency !== null) {
            villageId = villageIdLookup[`${p.tile_id}:${p.residency}`] ?? null;
        }

        pipeline.hset('person', p.id.toString(), JSON.stringify({
            id: p.id,
            tile_id: p.tile_id,
            residency: p.residency,
            village_id: villageId,  // Computed from tile_id + residency
            sex: sex,
            health: p.health ?? 100,
            family_id: p.family_id,
            date_of_birth: p.date_of_birth,
        }));

        // Index: which village does this person belong to?
        if (p.tile_id && p.residency !== null) {
            pipeline.sadd(`village:${p.tile_id}:${p.residency}:people`, p.id.toString());
        }

        // Count demographics
        if (sex === true) maleCount++;
        else femaleCount++;
    }

    return { people, maleCount, femaleCount };
}

/**
 * Load families from PostgreSQL into storage pipeline
 */
async function loadFamilies(pipeline: Pipeline): Promise<FamilyRow[]> {
    const { rows: families } = await pool.query<FamilyRow>('SELECT * FROM family');
    for (const f of families) {
        pipeline.hset('family', f.id.toString(), JSON.stringify({
            id: f.id,
            husband_id: f.husband_id,
            wife_id: f.wife_id,
            tile_id: f.tile_id,
            pregnancy: f.pregnancy || false,
            delivery_date: f.delivery_date || null,
            children_ids: f.children_ids || [],
        }));
    }
    return families;
}

/**
 * Populate fertile family candidates from loaded families
 */
async function populateFertileFamilies(families: FamilyRow[], people: PersonRow[], calendarService?: CalendarService): Promise<void> {
    try {
        const peopleMap: PeopleMap = {};
        for (const p of people) peopleMap[p.id] = p;

        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getState === 'function') {
            const cs = calendarService.getState();
            if (cs && cs.currentDate) currentDate = cs.currentDate;
        }

        const PopulationState = require('../populationState').default;
        for (const f of families) {
            try {
                const childrenCount = (f.children_ids || []).length;
                if (f.pregnancy || childrenCount >= 5) continue;
                if (f.wife_id === null) continue;
                const wife = peopleMap[f.wife_id];
                if (!wife || !wife.date_of_birth) continue;
                await PopulationState.addFertileFamily(f.id, currentDate.year, currentDate.month, currentDate.day);
            } catch (e: unknown) { console.warn('[loadOperations] Failed to add fertile family:', f.id, (e as Error)?.message ?? e); }
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to populate fertile family sets on load:', errMsg);
    }
}

/**
 * Load cleared land counts per village
 */
async function loadClearedLandCounts(pipeline: Pipeline): Promise<void> {
    const { rows: landCounts } = await pool.query<LandCountRow>(`
        SELECT v.id as village_id, COUNT(*) as cleared_cnt
        FROM villages v
        JOIN tiles_lands tl ON tl.tile_id = v.tile_id 
            AND tl.chunk_index = v.land_chunk_index 
            AND tl.cleared = true
        GROUP BY v.id
    `);

    for (const lc of landCounts) {
        pipeline.hset('village:cleared', lc.village_id.toString(), lc.cleared_cnt.toString());
    }
}

/**
 * Populate eligible matchmaking sets based on loaded people
 */
async function populateEligibleSets(people: PersonRow[], calendarService?: CalendarService): Promise<void> {
    try {
        const PopulationState = require('../populationState').default;
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getState === 'function') {
            const cs = calendarService.getState();
            if (cs && cs.currentDate) currentDate = cs.currentDate;
        }

        for (const p of people) {
            try {
                await PopulationState.addEligiblePerson(p, currentDate.year, currentDate.month, currentDate.day);
            } catch (e: unknown) {
                /* ignore individual failures */
            }
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to populate eligible sets on load:', errMsg);
    }
}

export {
    loadFromDatabase,
    clearExistingStorageState,
    loadTiles,
    loadTilesLands,
    loadVillages,
    loadPeople,
    loadFamilies,
    populateFertileFamilies,
    loadClearedLandCounts,
    populateEligibleSets
};
