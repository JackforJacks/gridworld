/**
 * Village Manager - Robust, self-contained village logic
 * 
 * This module is the single source of truth for all village operations:
 * - Creating villages for populated tiles
 * - Assigning people to villages (residency)
 * - Validating village-people consistency
 * - Repairing broken village state
 */

const storage = require('../storage');
const idAllocator = require('../idAllocator');

const DEFAULT_HOUSING_CAPACITY = 1000;
const MAX_VILLAGES_PER_TILE = 30;

/**
 * Ensure villages exist for all populated tiles
 * Creates villages if missing, repairs if inconsistent
 * 
 * @param {Object} options
 * @param {boolean} options.force - Force regeneration even if villages exist
 * @returns {Promise<Object>} Result with village counts
 */
async function ensureVillagesForPopulatedTiles(options = {}) {
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

        console.log(`[VillageManager] Found ${populatedTileIds.length} populated tiles with people`);

        // Step 2: Get existing villages grouped by tile
        const villagesByTile = await getVillagesGroupedByTile();

        // Step 3: For each populated tile, ensure it has villages
        let totalCreated = 0;
        const allVillages = [];

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
                console.log(`[VillageManager] Created ${newVillageCount} villages for tile ${tileId}`);
            }

            // Keep existing villages if not forcing
            if (!force) {
                allVillages.push(...existingVillages);
            }
        }

        // Step 4: Assign residency to all people
        const assigned = await assignResidencyToAllPeople(populatedTileIds, allVillages, peopleByTile);

        console.log(`[VillageManager] ✅ Complete: ${totalCreated} villages created, ${assigned} people assigned`);

        return {
            success: true,
            created: totalCreated,
            assigned: assigned,
            tiles: populatedTileIds.length,
            totalVillages: allVillages.length
        };

    } catch (err) {
        console.error('[VillageManager] Error ensuring villages:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get all people grouped by tile_id
 */
async function getPeopleGroupedByTile() {
    const peopleRaw = await storage.hgetall('person') || {};
    const byTile = {};
    let totalPeople = 0;
    let noTileId = 0;

    for (const [id, json] of Object.entries(peopleRaw)) {
        try {
            const person = JSON.parse(json);
            totalPeople++;
            if (person.tile_id !== undefined && person.tile_id !== null) {
                const tid = String(person.tile_id);
                if (!byTile[tid]) byTile[tid] = [];
                byTile[tid].push(person);
            } else {
                noTileId++;
            }
        } catch (e) {
            // Skip invalid JSON
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
async function getVillagesGroupedByTile() {
    const villagesRaw = await storage.hgetall('village') || {};
    const byTile = {};

    for (const [id, json] of Object.entries(villagesRaw)) {
        try {
            const village = JSON.parse(json);
            if (village.tile_id !== undefined && village.tile_id !== null) {
                const tid = village.tile_id;
                if (!byTile[tid]) byTile[tid] = [];
                byTile[tid].push(village);
            }
        } catch (e) {
            // Skip invalid JSON
        }
    }

    return byTile;
}

/**
 * Get cleared chunks for a tile
 */
async function getClearedChunksForTile(tileId) {
    const landsJson = await storage.hget('tile:lands', tileId.toString());
    if (!landsJson) return [];

    try {
        const lands = JSON.parse(landsJson);
        const cleared = lands
            .filter(land => land.land_type === 'cleared' || land.cleared === true)
            .map(land => land.chunk_index);

        // Shuffle for randomness
        for (let i = cleared.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cleared[i], cleared[j]] = [cleared[j], cleared[i]];
        }

        return cleared;
    } catch (e) {
        return [];
    }
}

/**
 * Create cleared chunks for a tile if none exist
 */
async function createClearedChunksForTile(tileId, count) {
    const chunks = [];
    const lands = [];

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
async function assignResidencyToAllPeople(populatedTileIds, allVillages, peopleByTile) {
    // Group villages by tile for quick lookup
    const villagesByTile = {};
    for (const v of allVillages) {
        if (!villagesByTile[v.tile_id]) villagesByTile[v.tile_id] = [];
        villagesByTile[v.tile_id].push(v);
    }

    let totalAssigned = 0;
    const personPipeline = storage.pipeline();
    const villagePipeline = storage.pipeline();
    const membershipOps = []; // Track membership set operations

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
            const oldResidency = person.residency;
            const newResidency = village.land_chunk_index;
            person.residency = newResidency;
            person.village_id = village.id;  // Critical: link person to village

            // Add to village housing
            village.housing_slots.push(person.id);

            // Queue person update
            personPipeline.hset('person', person.id.toString(), JSON.stringify(person));

            // Queue membership set updates
            if (oldResidency !== undefined && oldResidency !== null && oldResidency !== newResidency) {
                membershipOps.push({ op: 'srem', key: `village:${tileId}:${oldResidency}:people`, id: person.id.toString() });
            }
            membershipOps.push({ op: 'sadd', key: `village:${tileId}:${newResidency}:people`, id: person.id.toString() });

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

    // Execute membership operations
    if (membershipOps.length > 0) {
        const memberPipeline = storage.pipeline();
        for (const op of membershipOps) {
            if (op.op === 'srem') {
                memberPipeline.srem(op.key, op.id);
            } else {
                memberPipeline.sadd(op.key, op.id);
            }
        }
        await memberPipeline.exec();
    }

    return totalAssigned;
}

/**
 * Validate that villages and people are consistent
 */
async function validateVillageConsistency() {
    const peopleByTile = await getPeopleGroupedByTile();
    const villagesByTile = await getVillagesGroupedByTile();

    const issues = [];
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

module.exports = {
    ensureVillagesForPopulatedTiles,
    validateVillageConsistency,
    repairVillageConsistency,
    getPeopleGroupedByTile,
    getVillagesGroupedByTile,
    // Constants for external use
    DEFAULT_HOUSING_CAPACITY,
    MAX_VILLAGES_PER_TILE
};
