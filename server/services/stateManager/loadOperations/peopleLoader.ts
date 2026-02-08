// Load Operations - People Loader Module
// Optimized with raw data return
import pool from '../../../config/database';
import { PersonRow, LoadPeopleResult } from './types';

/** Raw person data for batched Redis insertion */
export interface PersonLoadResult {
    people: PersonRow[];
    peopleData: Array<{ id: string; json: string }>;
    maleCount: number;
    femaleCount: number;
}

/**
 * Fetch people from PostgreSQL (query only, no Redis writes)
 */
export async function fetchPeople(): Promise<PersonLoadResult> {
    const { rows: people } = await pool.query<PersonRow>('SELECT * FROM people');

    let maleCount = 0;
    let femaleCount = 0;
    const peopleData: Array<{ id: string; json: string }> = [];

    for (const p of people) {
        // Normalize sex to boolean
        const sex = p.sex === true || p.sex === 'true' || p.sex === 1 ? true : false;

        peopleData.push({
            id: p.id.toString(),
            json: JSON.stringify({
                id: p.id,
                tile_id: p.tile_id,
                residency: p.residency,
                sex: sex,
                health: p.health ?? 100,
                family_id: p.family_id,
                date_of_birth: p.date_of_birth,
            }),
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
import { Pipeline } from './types';

export async function loadPeople(pipeline: Pipeline): Promise<LoadPeopleResult> {
    const { people, peopleData, maleCount, femaleCount } = await fetchPeople();

    for (const p of peopleData) {
        pipeline.hset('person', p.id, p.json);
    }

    return { people, maleCount, femaleCount };
}
