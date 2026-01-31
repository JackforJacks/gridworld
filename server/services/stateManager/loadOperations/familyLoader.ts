// Load Operations - Family Loader Module
// Optimized with raw data return for batched pipeline
import pool from '../../../config/database';
import { FamilyRow } from './types';

/** Raw family data for batched Redis insertion */
export interface FamilyLoadResult {
    families: FamilyRow[];
    familiesData: Array<{ id: string; json: string }>;
}

/**
 * Fetch families from PostgreSQL (query only, no Redis writes)
 */
export async function fetchFamilies(): Promise<FamilyLoadResult> {
    const { rows: families } = await pool.query<FamilyRow>('SELECT * FROM family');

    const familiesData = families.map(f => ({
        id: f.id.toString(),
        json: JSON.stringify({
            id: f.id,
            husband_id: f.husband_id,
            wife_id: f.wife_id,
            tile_id: f.tile_id,
            pregnancy: f.pregnancy || false,
            delivery_date: f.delivery_date || null,
            children_ids: f.children_ids || [],
        })
    }));

    return { families, familiesData };
}

// Legacy function for backward compatibility
import { Pipeline } from './types';

export async function loadFamilies(pipeline: Pipeline): Promise<FamilyRow[]> {
    const { families, familiesData } = await fetchFamilies();
    for (const f of familiesData) {
        pipeline.hset('family', f.id, f.json);
    }
    return families;
}
