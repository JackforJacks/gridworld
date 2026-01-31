/**
 * PersonCrud - Single-person CRUD operations
 * 
 * Handles:
 * - addPerson, removePerson, updatePerson, getPerson
 * - getAllPeople, getTilePopulation
 * - Global counts management
 */

import storage from '../storage';
import idAllocator from '../idAllocator';
import { 
    StoredPerson, 
    PersonInput, 
    PersonUpdates, 
    GlobalCounts, 
    PipelineResult,
    getErrorMessage 
} from './types';
import { removeEligiblePerson } from './EligibleSets';

/**
 * Get the next real Postgres ID for a new person
 */
export async function getNextId(): Promise<number> {
    return idAllocator.getNextPersonId();
}

/**
 * Get a batch of real Postgres IDs for multiple new people
 */
export async function getIdBatch(count: number): Promise<number[]> {
    return idAllocator.getPersonIdBatch(count);
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
        const p = {
            id: person.id,
            tile_id: person.tile_id,
            residency: person.residency,
            sex: person.sex,
            health: person.health || 100,
            date_of_birth: person.date_of_birth,
            family_id: person.family_id || null,
            _isNew: isNew
        };
        await storage.hset('person', id, JSON.stringify(p));
        
        // Add to tile's village population set
        if (p.tile_id && p.residency !== null && p.residency !== undefined) {
            await storage.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
        }
        
        // Update global counts
        await storage.hincrby('counts:global', 'total', 1);
        if (p.sex === true) await storage.hincrby('counts:global', 'male', 1);
        else if (p.sex === false) await storage.hincrby('counts:global', 'female', 1);

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

        // Remove from tile's village population set
        if (p.tile_id && p.residency !== null && p.residency !== undefined) {
            await storage.srem(`village:${p.tile_id}:${p.residency}:people`, personId.toString());
        }

        // Decrement global counts
        await storage.hincrby('counts:global', 'total', -1);
        if (p.sex === true) await storage.hincrby('counts:global', 'male', -1);
        else if (p.sex === false) await storage.hincrby('counts:global', 'female', -1);

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

        const oldTileId = person.tile_id;
        const oldResidency = person.residency;

        const updated = { ...person, ...updates };
        await storage.hset('person', personId.toString(), JSON.stringify(updated));

        // Handle tile/residency change: update village sets
        if ((updates.tile_id !== undefined && updates.tile_id !== oldTileId) ||
            (updates.residency !== undefined && updates.residency !== oldResidency)) {
            if (oldTileId && oldResidency !== null && oldResidency !== undefined) {
                await storage.srem(`village:${oldTileId}:${oldResidency}:people`, personId.toString());
            }
            const newTile = updates.tile_id !== undefined ? updates.tile_id : oldTileId;
            const newRes = updates.residency !== undefined ? updates.residency : oldResidency;
            if (newTile && newRes !== null && newRes !== undefined) {
                await storage.sadd(`village:${newTile}:${newRes}:people`, personId.toString());
            }
        }

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
 */
export async function getAllPeople(): Promise<StoredPerson[]> {
    if (!storage.isAvailable()) return [];
    const data = await storage.hgetall('person');
    return Object.values(data).map((json) => JSON.parse(json as string) as StoredPerson);
}

/**
 * Get people by tile and residency (village)
 */
export async function getTilePopulation(tileId: number, residency: number): Promise<StoredPerson[]> {
    if (!storage.isAvailable()) return [];
    try {
        const ids = await storage.smembers(`village:${tileId}:${residency}:people`);
        if (ids.length === 0) return [];

        const pipeline = storage.pipeline();
        for (const id of ids) {
            pipeline.hget('person', id);
        }
        const results = await pipeline.exec() as PipelineResult;

        const people: StoredPerson[] = [];
        for (const [err, json] of results) {
            if (!err && json) {
                try {
                    people.push(JSON.parse(json as string) as StoredPerson);
                } catch { /* skip invalid JSON */ }
            }
        }
        return people;
    } catch (err: unknown) {
        console.warn('[PersonCrud] getTilePopulation failed:', getErrorMessage(err));
        return [];
    }
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
