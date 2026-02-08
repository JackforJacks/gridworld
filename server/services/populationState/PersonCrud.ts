/**
 * PersonCrud - Single-person CRUD operations
 * 
 * Handles:
 * - addPerson, removePerson, updatePerson, getPerson
 * - getAllPeople
 * - Global counts management
 */

import storage from '../storage';
import rustSimulation from '../rustSimulation';
import {
    StoredPerson,
    PersonInput,
    PersonUpdates,
    GlobalCounts,
    getErrorMessage
} from './types';
import { removeEligiblePerson } from './EligibleSets';

/** Check if sex value represents male (handles various data formats) */
function checkIsMale(sex: boolean | string | number | null | undefined): boolean {
    return sex === true || sex === 'true' || sex === 1 || sex === 't' || sex === 'M';
}

/**
 * Get the next person ID from Rust ECS
 */
export function getNextId(): number {
    return rustSimulation.getNextPersonId();
}

/**
 * Get a batch of person IDs from Rust ECS
 */
export function getIdBatch(count: number): number[] {
    return rustSimulation.getPersonIdBatch(count);
}

/**
 * Add a person to Redis
 */
export async function addPerson(person: PersonInput, isNew: boolean = false): Promise<boolean> {
    if (!storage.isAvailable()) {
        console.warn('[PersonCrud] addPerson failed: storage not available');
        return false;
    }
    if (!person || person.id === undefined || person.id === null) {
        console.warn('[PersonCrud] addPerson failed: person.id is missing or undefined:', person);
        return false;
    }
    try {
        const id = person.id.toString();

        // Check if person already exists
        const existing = await storage.hget('person', id);

        const p = {
            id: person.id,
            tile_id: person.tile_id,
            sex: person.sex,
            health: person.health || 100,
            date_of_birth: person.date_of_birth,
            family_id: person.family_id || null,
            _isNew: isNew
        };
        await storage.hset('person', id, JSON.stringify(p));

        // Update global counts (only if truly new)
        if (!existing) {
            await storage.hincrby('counts:global', 'total', 1);
            if (checkIsMale(p.sex)) await storage.hincrby('counts:global', 'male', 1);
            else await storage.hincrby('counts:global', 'female', 1);
        }

        if (isNew) {
            await storage.sadd('pending:person:inserts', id);
        }
        return true;
    } catch (err: unknown) {
        console.warn('[PersonCrud] addPerson failed:', getErrorMessage(err));
        return false;
    }
}

/**
 * Remove a person from Redis
 */
export async function removePerson(personId: number, markDeleted: boolean = false): Promise<boolean> {
    if (!storage.isAvailable()) return false;
    try {
        const json = await storage.hget('person', personId.toString());
        if (!json) return false;
        const p = JSON.parse(json);

        // Decrement global counts
        await storage.hincrby('counts:global', 'total', -1);
        if (checkIsMale(p.sex)) await storage.hincrby('counts:global', 'male', -1);
        else await storage.hincrby('counts:global', 'female', -1);

        // Remove from eligible sets if present
        await removeEligiblePerson(personId);

        await storage.hdel('person', personId.toString());

        if (markDeleted && personId > 0) {
            await storage.sadd('pending:person:deletes', personId.toString());
        }
        if (personId < 0) {
            await storage.srem('pending:person:inserts', personId.toString());
        }

        return true;
    } catch (err: unknown) {
        console.warn('[PersonCrud] removePerson failed:', getErrorMessage(err));
        return false;
    }
}

/**
 * Get a person from Redis
 */
export async function getPerson(personId: number): Promise<StoredPerson | null> {
    if (!storage.isAvailable()) return null;
    const json = await storage.hget('person', personId.toString());
    return json ? JSON.parse(json) as StoredPerson : null;
}

/**
 * Update a person in Redis
 */
export async function updatePerson(personId: number, updates: PersonUpdates): Promise<boolean> {
    if (!storage.isAvailable()) return false;
    try {
        const person = await getPerson(personId);
        if (!person) return false;

        const updated = { ...person, ...updates };
        await storage.hset('person', personId.toString(), JSON.stringify(updated));

        // Track modified people for batch update (only for existing Postgres records)
        if (personId > 0 && !person._isNew) {
            await storage.sadd('pending:person:updates', personId.toString());
        }
        return true;
    } catch (err: unknown) {
        console.warn('[PersonCrud] updatePerson failed:', getErrorMessage(err));
        return false;
    }
}

/**
 * Get all people from Redis
 * WARNING: This loads all people into memory. For large populations, use streamAllPeople() instead.
 */
export async function getAllPeople(): Promise<StoredPerson[]> {
    if (!storage.isAvailable()) return [];
    const data = await storage.hgetall('person');
    return Object.values(data).map((json) => JSON.parse(json as string) as StoredPerson);
}

/**
 * Stream all people from Redis using HSCAN - memory efficient for large populations
 * @param callback Called for each batch of people
 * @param batchSize Number of records per HSCAN iteration (default 500)
 */
export async function streamAllPeople(
    callback: (people: StoredPerson[]) => Promise<void>,
    batchSize = 500
): Promise<{ total: number }> {
    if (!storage.isAvailable()) return { total: 0 };

    let total = 0;
    const personStream = storage.hscanStream('person', { count: batchSize });

    for await (const result of personStream) {
        const entries = result as string[];
        const batch: StoredPerson[] = [];

        for (let i = 0; i < entries.length; i += 2) {
            const json = entries[i + 1];
            if (!json) continue;
            try {
                batch.push(JSON.parse(json) as StoredPerson);
            } catch { /* ignore parse errors */ }
        }

        if (batch.length > 0) {
            total += batch.length;
            await callback(batch);
        }
    }

    return { total };
}

/**
 * Get global counts from Redis
 */
export async function getGlobalCounts(): Promise<GlobalCounts> {
    if (!storage.isAvailable()) return { total: 0, male: 0, female: 0 };
    const counts = await storage.hgetall('counts:global');
    return {
        total: parseInt(counts.total || '0', 10),
        male: parseInt(counts.male || '0', 10),
        female: parseInt(counts.female || '0', 10)
    };
}

/**
 * Get total population count
 */
export async function getTotalPopulation(): Promise<number> {
    const counts = await getGlobalCounts();
    return counts.total;
}
