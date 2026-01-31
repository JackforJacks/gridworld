// Load Operations - Village Loader Module
// Optimized with parallel queries and raw data return for batched pipeline
import pool from '../../../config/database';
import { VillageRow, LandCountRow } from './types';

/** Raw village data for batched Redis insertion */
export interface VillageLoadResult {
    villages: VillageRow[];
    villagesData: Array<{ id: string; json: string }>;
    villageLookup: Map<string, number>; // "tile_id:chunk_index" -> village_id
}

/** Raw land count data for batched Redis insertion */
export interface LandCountLoadResult {
    landCountsData: Array<{ villageId: string; count: string }>;
}

/**
 * Fetch villages from PostgreSQL (query only, no Redis writes)
 * Returns raw data for batched pipeline insertion
 */
export async function fetchVillages(): Promise<VillageLoadResult> {
    const { rows: villages } = await pool.query<VillageRow>('SELECT * FROM villages');

    const villagesData: Array<{ id: string; json: string }> = [];
    const villageLookup = new Map<string, number>();

    for (const v of villages) {
        let housingSlots: number[] = [];
        try {
            if (Array.isArray(v.housing_slots)) {
                housingSlots = v.housing_slots;
            } else if (v.housing_slots) {
                housingSlots = JSON.parse(v.housing_slots as string);
                if (!Array.isArray(housingSlots)) {
                    housingSlots = [];
                }
            }
        } catch (_: unknown) {
            housingSlots = [];
        }

        villagesData.push({
            id: v.id.toString(),
            json: JSON.stringify({
                id: v.id,
                tile_id: v.tile_id,
                land_chunk_index: v.land_chunk_index,
                name: v.name,
                food_stores: parseFloat(String(v.food_stores)) || 0,
                food_capacity: parseInt(String(v.food_capacity)) || 1000,
                food_production_rate: parseFloat(String(v.food_production_rate)) || 0,
                housing_capacity: parseInt(String(v.housing_capacity)) || 100,
                housing_slots: housingSlots,
            })
        });

        // Build lookup for people loader
        villageLookup.set(`${v.tile_id}:${v.land_chunk_index}`, v.id);
    }

    return { villages, villagesData, villageLookup };
}

/**
 * Fetch cleared land counts from PostgreSQL (query only, no Redis writes)
 */
export async function fetchClearedLandCounts(): Promise<LandCountLoadResult> {
    const { rows: landCounts } = await pool.query<LandCountRow>(`
        SELECT v.id as village_id, COUNT(*) as cleared_cnt
        FROM villages v
        JOIN tiles_lands tl ON tl.tile_id = v.tile_id 
            AND tl.chunk_index = v.land_chunk_index 
            AND tl.cleared = true
        GROUP BY v.id
    `);

    const landCountsData = landCounts.map(lc => ({
        villageId: lc.village_id.toString(),
        count: lc.cleared_cnt.toString()
    }));

    return { landCountsData };
}

// Legacy functions for backward compatibility
import { Pipeline } from './types';

export async function loadVillages(pipeline: Pipeline): Promise<VillageRow[]> {
    const { villages, villagesData } = await fetchVillages();
    for (const v of villagesData) {
        pipeline.hset('village', v.id, v.json);
    }
    return villages;
}

export async function loadClearedLandCounts(pipeline: Pipeline): Promise<void> {
    const { landCountsData } = await fetchClearedLandCounts();
    for (const lc of landCountsData) {
        pipeline.hset('village:cleared', lc.villageId, lc.count);
    }
}
