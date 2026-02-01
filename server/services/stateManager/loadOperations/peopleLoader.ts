// Load Operations - People Loader Module
// Optimized with pre-built village lookup and raw data return
import pool from '../../../config/database';
import { PersonRow, LoadPeopleResult } from './types';

/** Raw person data for batched Redis insertion */
export interface PersonLoadResult {
    people: PersonRow[];
    peopleData: Array<{ id: string; json: string; villageKey: string | null }>;
    maleCount: number;
    femaleCount: number;
}

/**
 * Fetch people from PostgreSQL (query only, no Redis writes)
 * @param villageLookup - Pre-built map from "tile_id:chunk_index" -> village_id
 */
export async function fetchPeople(villageLookup: Map<string, number>): Promise<PersonLoadResult> {
    const { rows: people } = await pool.query<PersonRow>('SELECT * FROM people');

    let maleCount = 0;
    let femaleCount = 0;
    const peopleData: Array<{ id: string; json: string; villageKey: string | null }> = [];

    for (const p of people) {
        // Normalize sex to boolean
        const sex = p.sex === true || p.sex === 'true' || p.sex === 1 ? true : false;

        // Compute village_id from tile_id and residency (land_chunk_index)
        // Only assign villageKey for valid residency (> 0), residency 0 means unassigned
        let villageId: number | null = null;
        let villageKey: string | null = null;
        if (p.tile_id !== null && p.residency !== null && p.residency !== 0) {
            const key = `${p.tile_id}:${p.residency}`;
            villageId = villageLookup.get(key) ?? null;
            villageKey = key;
        }

        peopleData.push({
            id: p.id.toString(),
            json: JSON.stringify({
                id: p.id,
                tile_id: p.tile_id,
                residency: p.residency,
                village_id: villageId,
                sex: sex,
                health: p.health ?? 100,
                family_id: p.family_id,
                date_of_birth: p.date_of_birth,
            }),
            villageKey
        });

        // Count demographics
        if (sex === true) {
            maleCount++;
        } else {
            femaleCount++;
        }
    }

    return { people, peopleData, maleCount, femaleCount };
}

// Legacy function for backward compatibility
import { Pipeline, VillageIdLookup } from './types';

export async function loadPeople(pipeline: Pipeline): Promise<LoadPeopleResult> {
    // First, load villages to build a lookup map: (tile_id, land_chunk_index) -> village_id
    const { rows: villageRows } = await pool.query<{ id: number; tile_id: number; land_chunk_index: number }>(
        'SELECT id, tile_id, land_chunk_index FROM villages'
    );

    const villageLookup = new Map<string, number>();
    for (const v of villageRows) {
        villageLookup.set(`${v.tile_id}:${v.land_chunk_index}`, v.id);
    }

    const { people, peopleData, maleCount, femaleCount } = await fetchPeople(villageLookup);

    for (const p of peopleData) {
        pipeline.hset('person', p.id, p.json);
        if (p.villageKey) {
            pipeline.sadd(`village:${p.villageKey}:people`, p.id);
        }
    }

    return { people, maleCount, femaleCount };
}
