/**
 * Village Manager - Robust, self-contained village logic
 * 
 * This module is the single source of truth for all village operations:
 * - Creating villages for populated tiles
 * - Assigning people to villages (residency)
 * - Validating village-people consistency
 * - Repairing broken village state
 */

import storage from '../storage/index';
import idAllocator from '../idAllocator';

const DEFAULT_HOUSING_CAPACITY = 1000;
const MAX_VILLAGES_PER_TILE = 30;

/** Village data structure */
interface Village {
    id: number;
    tile_id: number;
    land_chunk_index: number;
    name: string;
    housing_slots: number[];
    housing_capacity: number;
    food_stores: number;
    food_capacity: number;
    food_production_rate: number;
}

/** Person data structure */
interface Person {
    id: number;
    tile_id: number | null;
    sex: 'M' | 'F';
    date_of_birth: string;
    residency: number | null;
    family_id: number | null;
    village_id?: number;
}

/** Land chunk structure */
interface LandChunk {
    tile_id: number;
    chunk_index: number;
    land_type: string;
    cleared: boolean;
}

/** Membership operation for batch updates */
interface MembershipOp {
    op: 'sadd' | 'srem';
    key: string;
    id: string;
}

/** Options for ensureVillagesForPopulatedTiles */
interface EnsureVillagesOptions {
    force?: boolean;
}

/** Result from ensureVillagesForPopulatedTiles */
interface EnsureVillagesResult {
    success: boolean;
    error?: string;
    created?: number;
    assigned?: number;
    tiles?: number;
    totalVillages?: number;
}

/** Consistency issue types */
interface ConsistencyIssue {
    type: 'missing_village' | 'orphan_village' | 'no_residency' | 'no_village_id';
    tileId: string;
    peopleCount?: number;
    villageCount?: number;
    count?: number;
}

/** Validation result */
interface ValidationResult {
    valid: boolean;
    issues: ConsistencyIssue[];
    summary: {
        populatedTiles: number;
        tilesWithVillages: number;
        totalPeople: number;
        totalVillages: number;
    };
}

/** People grouped by tile ID */
interface PeopleByTile {
    [tileId: string]: Person[];
}

/** Villages grouped by tile ID */
interface VillagesByTile {
    [tileId: number]: Village[];
}

/**
 * Ensure villages exist for all populated tiles
 * Creates villages if missing, repairs if inconsistent
 * 
 * @param options - Options for village creation
 * @param options.force - Force regeneration even if villages exist
 * @returns Result with village counts
 */
async function ensureVillagesForPopulatedTiles(options: EnsureVillagesOptions = {}): Promise<EnsureVillagesResult> {
    const force = options.force || false;

    if (!storage.isAvailable()) {
        console.error('[VillageManager] Storage not available');
        return { success: false, error: 'Storage not available' };
    }

    try {
        // Step 1: Get all people grouped by tile
        const peopleByTile = await getPeopleGroupedByTile();
        const populatedTileIds = Object.keys(peopleByTile).filter(tid => peopleByTile[tid].length > 0);

        if (populatedTileIds.length === 0) {
            console.log('[VillageManager] No populated tiles found');
            return { success: true, created: 0, assigned: 0, tiles: 0 };
        }

        // Step 2: Get existing villages grouped by tile
        const villagesByTile = await getVillagesGroupedByTile();

        // Step 3: For each populated tile, ensure it has villages
        let totalCreated = 0;
        const allVillages: Village[] = [];

        for (const tileIdStr of populatedTileIds) {
            const tileId = parseInt(tileIdStr);
            const existingVillages = villagesByTile[tileId] || [];
            const peopleCount = peopleByTile[tileIdStr].length;

            // Calculate how many villages this tile needs
            const desiredVillages = Math.max(1, Math.min(MAX_VILLAGES_PER_TILE, Math.ceil(peopleCount / DEFAULT_HOUSING_CAPACITY)));

            if (!force && existingVillages.length >= desiredVillages) {
                // Tile already has enough villages
                allVillages.push(...existingVillages);
                continue;
            }

            // Need to create villages for this tile
            const clearedChunks = await getClearedChunksForTile(tileId);

            // If no cleared chunks, create some
            let chunksToUse = clearedChunks.slice(0, desiredVillages);
            if (chunksToUse.length === 0) {
                chunksToUse = await createClearedChunksForTile(tileId, desiredVillages);
            }

            // Clear existing villages for this tile if forcing
            if (force && existingVillages.length > 0) {
                const pipeline = storage.pipeline();
                for (const v of existingVillages) {
                    pipeline.hdel('village', v.id.toString());
                }
                await pipeline.exec();
            }

            // Create new villages
            const newVillageCount = Math.max(0, desiredVillages - (force ? 0 : existingVillages.length));
            if (newVillageCount > 0 && chunksToUse.length > 0) {
                const villageIds = await idAllocator.getVillageIdBatch(newVillageCount);
                const pipeline = storage.pipeline();

                for (let i = 0; i < newVillageCount && i < chunksToUse.length; i++) {
                    const village = {
                        id: villageIds[i],
                        tile_id: tileId,
                        land_chunk_index: chunksToUse[i],
                        name: `Village ${tileId}-${chunksToUse[i]}`,
                        housing_slots: [],
                        housing_capacity: DEFAULT_HOUSING_CAPACITY,
                        food_stores: 200,
                        food_capacity: 1000,
                        food_production_rate: 0.5
                    };

                    pipeline.hset('village', village.id.toString(), JSON.stringify(village));
                    pipeline.hset('village:cleared', village.id.toString(), '1');
                    allVillages.push(village);
                    totalCreated++;
                }

                await pipeline.exec();
            }

            // Keep existing villages if not forcing
            if (!force) {
                allVillages.push(...existingVillages);
            }
        }

        // Step 4: Assign residency to all people
        const assigned = await assignResidencyToAllPeople(populatedTileIds, allVillages, peopleByTile);


        return {
            success: true,
            created: totalCreated,
            assigned: assigned,
            tiles: populatedTileIds.length,
            totalVillages: allVillages.length
        };

    } catch (err: unknown) {
        console.error('[VillageManager] Error ensuring villages:', err);
        return { success: false, error: err instanceof Error ? (err as Error).message : String(err) };
    }
}

/**
 * Get all people grouped by tile_id using HSCAN streaming for memory efficiency
 */
async function getPeopleGroupedByTile(): Promise<PeopleByTile> {
    const byTile: PeopleByTile = {};
    let totalPeople = 0;
    let noTileId = 0;

    const personStream = storage.hscanStream('person', { count: 500 });

    for await (const result of personStream) {
        const entries = result as string[];
        for (let i = 0; i < entries.length; i += 2) {
            const json = entries[i + 1];
            if (!json) continue;

            try {
                const person = JSON.parse(json as string) as Person;
                totalPeople++;
                if (person.tile_id !== undefined && person.tile_id !== null) {
                    const tid = String(person.tile_id);
                    if (!byTile[tid]) byTile[tid] = [];
                    byTile[tid].push(person);
                } else {
                    noTileId++;
                }
            } catch (e: unknown) {
                // Skip invalid JSON
            }
        }
    }

    if (noTileId > 0) {
        console.warn(`[VillageManager] ⚠️ ${noTileId} people have no tile_id (out of ${totalPeople} total)`);
    }

    return byTile;
}
/**
 * Get all villages grouped by tile_id
 */
async function getVillagesGroupedByTile(): Promise<VillagesByTile> {
    const villagesRaw = await storage.hgetall('village') || {};
    const byTile: VillagesByTile = {};

    for (const [id, json] of Object.entries(villagesRaw)) {
        try {
            const village = JSON.parse(json as string) as Village;
            if (village.tile_id !== undefined && village.tile_id !== null) {
                const tid = village.tile_id;
                if (!byTile[tid]) byTile[tid] = [];
                byTile[tid].push(village);
            }
        } catch (e: unknown) {
            // Skip invalid JSON
        }
    }

    return byTile;
}

/**
 * Get cleared chunks for a tile
 */
async function getClearedChunksForTile(tileId: number): Promise<number[]> {
    const landsJson = await storage.hget('tile:lands', tileId.toString());
    if (!landsJson) return [];

    try {
        const lands = JSON.parse(landsJson) as LandChunk[];
        const cleared = lands
            .filter((land: LandChunk) => land.land_type === 'cleared' || land.cleared === true)
            .map((land: LandChunk) => land.chunk_index);

        // Shuffle for randomness
        for (let i = cleared.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cleared[i], cleared[j]] = [cleared[j], cleared[i]];
        }

        return cleared;
    } catch (e: unknown) {
        return [];
    }
}

/**
 * Create cleared chunks for a tile if none exist
 */
async function createClearedChunksForTile(tileId: number, count: number): Promise<number[]> {
    const chunks: number[] = [];
    const lands: LandChunk[] = [];

    // Create 100 land chunks, first 'count' are cleared
    for (let i = 0; i < 100; i++) {
        const isCleared = i < count;
        lands.push({
            tile_id: tileId,
            chunk_index: i,
            land_type: isCleared ? 'cleared' : 'forest',
            cleared: isCleared
        });
        if (isCleared) chunks.push(i);
    }

    await storage.hset('tile:lands', tileId.toString(), JSON.stringify(lands));
    console.log(`[VillageManager] Created ${count} cleared chunks for tile ${tileId}`);

    return chunks;
}

/**
 * Assign residency to all people on populated tiles
 */
async function assignResidencyToAllPeople(populatedTileIds: string[], allVillages: Village[], peopleByTile: PeopleByTile): Promise<number> {
    // Group villages by tile for quick lookup
    const villagesByTile: VillagesByTile = {};
    for (const v of allVillages) {
        if (!villagesByTile[v.tile_id]) villagesByTile[v.tile_id] = [];
        villagesByTile[v.tile_id].push(v);
    }

    // Build a set of all village set keys we'll be populating
    const newSetKeys = new Set<string>();
    for (const tileIdStr of populatedTileIds) {
        const tileId = parseInt(tileIdStr);
        const villages = villagesByTile[tileId] || [];
        for (const v of villages) {
            newSetKeys.add(`village:${tileId}:${v.land_chunk_index}:people`);
        }
    }

    // First, remove all people from their CURRENT sets (based on person hash data)
    // This ensures no stale memberships remain
    const removePipeline = storage.pipeline();
    for (const tileIdStr of populatedTileIds) {
        const people = peopleByTile[tileIdStr] || [];
        for (const person of people) {
            // Remove from current set if they have a valid residency
            if (person.tile_id && person.residency !== null && person.residency !== undefined && person.residency !== 0) {
                removePipeline.srem(`village:${person.tile_id}:${person.residency}:people`, person.id.toString());
            }
        }
    }
    await removePipeline.exec();

    // Now clear the target sets to ensure they're empty before we populate
    const clearPipeline = storage.pipeline();
    for (const key of newSetKeys) {
        clearPipeline.del(key);
    }
    await clearPipeline.exec();

    let totalAssigned = 0;
    const personPipeline = storage.pipeline();
    const villagePipeline = storage.pipeline();
    const membershipPipeline = storage.pipeline();

    for (const tileIdStr of populatedTileIds) {
        const tileId = parseInt(tileIdStr);
        const villages = villagesByTile[tileId] || [];
        const people = peopleByTile[tileIdStr] || [];

        if (villages.length === 0) {
            console.warn(`[VillageManager] No villages for tile ${tileId} with ${people.length} people`);
            continue;
        }

        // Shuffle people for random distribution
        for (let i = people.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [people[i], people[j]] = [people[j], people[i]];
        }

        // Reset housing slots for fresh assignment
        for (const v of villages) {
            v.housing_slots = [];
        }

        // Distribute people across villages round-robin style
        let villageIndex = 0;
        for (const person of people) {
            const village = villages[villageIndex % villages.length];

            // Update person's residency
            const newResidency = village.land_chunk_index;
            person.residency = newResidency;
            person.village_id = village.id;  // Critical: link person to village

            // Add to village housing
            village.housing_slots.push(person.id);

            // Queue person update
            personPipeline.hset('person', person.id.toString(), JSON.stringify(person));

            // Queue membership set add
            if (newResidency !== 0) {
                membershipPipeline.sadd(`village:${tileId}:${newResidency}:people`, person.id.toString());
            }

            totalAssigned++;
            villageIndex++;
        }

        // Queue village updates
        for (const v of villages) {
            villagePipeline.hset('village', v.id.toString(), JSON.stringify(v));
        }
    }

    // Execute all updates
    await personPipeline.exec();
    await villagePipeline.exec();
    await membershipPipeline.exec();

    return totalAssigned;
}

/**
 * Validate that villages and people are consistent
 */
async function validateVillageConsistency(): Promise<ValidationResult> {
    const peopleByTile = await getPeopleGroupedByTile();
    const villagesByTile = await getVillagesGroupedByTile();

    const issues: ConsistencyIssue[] = [];
    const populatedTileIds = Object.keys(peopleByTile);
    const villageTileIds = Object.keys(villagesByTile);

    // Check for tiles with people but no villages
    for (const tileId of populatedTileIds) {
        if (!villagesByTile[tileId] || villagesByTile[tileId].length === 0) {
            issues.push({ type: 'missing_village', tileId, peopleCount: peopleByTile[tileId].length });
        }
    }

    // Check for villages on tiles without people
    for (const tileId of villageTileIds) {
        if (!peopleByTile[tileId] || peopleByTile[tileId].length === 0) {
            issues.push({ type: 'orphan_village', tileId, villageCount: villagesByTile[tileId].length });
        }
    }

    // Check for people without residency or village_id
    for (const tileId of populatedTileIds) {
        const noResidency = peopleByTile[tileId].filter(p => p.residency === undefined || p.residency === null);
        if (noResidency.length > 0) {
            issues.push({ type: 'no_residency', tileId, count: noResidency.length });
        }

        const noVillageId = peopleByTile[tileId].filter(p => !p.village_id);
        if (noVillageId.length > 0) {
            issues.push({ type: 'no_village_id', tileId, count: noVillageId.length });
        }
    }

    return {
        valid: issues.length === 0,
        issues,
        summary: {
            populatedTiles: populatedTileIds.length,
            tilesWithVillages: villageTileIds.length,
            totalPeople: Object.values(peopleByTile).flat().length,
            totalVillages: Object.values(villagesByTile).flat().length
        }
    };
}

/**
 * Repair any village consistency issues
 */
async function repairVillageConsistency() {
    console.log('[VillageManager] Running consistency repair...');

    const validation = await validateVillageConsistency();

    if (validation.valid) {
        console.log('[VillageManager] No issues found');
        return { repaired: false, ...validation };
    }

    console.log(`[VillageManager] Found ${validation.issues.length} issues, repairing...`);

    // Force regenerate all villages
    const result = await ensureVillagesForPopulatedTiles({ force: true });

    return {
        repaired: true,
        issues: validation.issues,
        result
    };
}

export {
    ensureVillagesForPopulatedTiles,
    validateVillageConsistency,
    repairVillageConsistency,
    getPeopleGroupedByTile,
    getVillagesGroupedByTile,
    // Constants for external use
    DEFAULT_HOUSING_CAPACITY,
    MAX_VILLAGES_PER_TILE
};
