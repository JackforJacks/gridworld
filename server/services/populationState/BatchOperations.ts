/**
 * BatchOperations - Batch CRUD operations for people
 * 
 * Handles:
 * - batchAddPersons, batchRemovePersons
 * - batchClearFamilyIds
 * - batchDeleteFamilies
 * - reassignIds
 */

import storage from '../storage';
import {
    StoredPerson,
    PersonInput,
    PipelineResult,
    IdMapping,
    getErrorMessage
} from './types';

/** Check if sex value represents male (handles various data formats) */
function checkIsMale(sex: boolean | string | number | null | undefined): boolean {
    return sex === true || sex === 'true' || sex === 1 || sex === 't' || sex === 'M';
}

/**
 * Batch clear family_id for multiple persons
 */
export async function batchClearFamilyIds(personIds: number[]): Promise<number> {
    if (!storage.isAvailable() || !personIds || personIds.length === 0) return 0;
    try {
        const readPipeline = storage.pipeline();
        for (const personId of personIds) {
            readPipeline.hget('person', personId.toString());
        }
        const readResults = await readPipeline.exec() as PipelineResult;

        const writePipeline = storage.pipeline();
        let updateCount = 0;

        for (let i = 0; i < personIds.length; i++) {
            const personId = personIds[i];
            const [err, json] = readResults[i];
            if (err || !json) continue;

            let person: StoredPerson;
            try { person = JSON.parse(json as string) as StoredPerson; } catch { continue; }

            person.family_id = null;
            writePipeline.hset('person', personId.toString(), JSON.stringify(person));

            if (personId > 0 && !person._isNew) {
                writePipeline.sadd('pending:person:updates', personId.toString());
            }
            updateCount++;
        }

        if (updateCount > 0) {
            await writePipeline.exec();
        }
        return updateCount;
    } catch (err: unknown) {
        console.warn('[BatchOperations] batchClearFamilyIds failed:', getErrorMessage(err));
        return 0;
    }
}

/**
 * Batch remove persons from Redis
 */
export async function batchRemovePersons(personIds: number[], markDeleted: boolean = false): Promise<number> {
    if (!storage.isAvailable() || !personIds || personIds.length === 0) return 0;
    try {
        const readPipeline = storage.pipeline();
        for (const personId of personIds) {
            readPipeline.hget('person', personId.toString());
        }
        const readResults = await readPipeline.exec() as PipelineResult;

        const personsData: Array<{ personId: number; person: StoredPerson }> = [];

        for (let i = 0; i < personIds.length; i++) {
            const personId = personIds[i];
            const [err, json] = readResults[i];
            if (err || !json) continue;

            let person: StoredPerson;
            try { person = JSON.parse(json as string) as StoredPerson; } catch { continue; }
            personsData.push({ personId, person });
        }

        const removePipeline = storage.pipeline();

        for (const { personId, person } of personsData) {
            const personIdStr = personId.toString();

            removePipeline.hincrby('counts:global', 'total', -1);
            if (checkIsMale(person.sex)) removePipeline.hincrby('counts:global', 'male', -1);
            else removePipeline.hincrby('counts:global', 'female', -1);

            if (person.tile_id) {
                const setKey = checkIsMale(person.sex) ? `eligible:males:tile:${person.tile_id}` : `eligible:females:tile:${person.tile_id}`;
                removePipeline.srem(setKey, personIdStr);
            }

            removePipeline.hdel('person', personIdStr);

            if (markDeleted && personId > 0) {
                removePipeline.sadd('pending:person:deletes', personIdStr);
            }
            if (personId < 0) {
                removePipeline.srem('pending:person:inserts', personIdStr);
            }
        }

        if (personsData.length > 0) {
            await removePipeline.exec();
        }

        return personsData.length;
    } catch (err: unknown) {
        console.warn('[BatchOperations] batchRemovePersons failed:', getErrorMessage(err));
        return 0;
    }
}

/**
 * Batch delete families from Redis
 */
export async function batchDeleteFamilies(familyIds: number[], markDeleted: boolean = false): Promise<number> {
    if (!storage.isAvailable() || !familyIds || familyIds.length === 0) return 0;
    try {
        const pipeline = storage.pipeline();

        for (const familyId of familyIds) {
            const familyIdStr = familyId.toString();
            pipeline.hdel('family', familyIdStr);
            if (markDeleted && familyId > 0) {
                pipeline.sadd('pending:family:deletes', familyIdStr);
            }
        }

        await pipeline.exec();
        return familyIds.length;
    } catch (err: unknown) {
        console.warn('[BatchOperations] batchDeleteFamilies failed:', getErrorMessage(err));
        return 0;
    }
}

/**
 * Batch add persons to Redis
 * @param persons - Array of persons to add
 * @param isNew - Whether these are new records (for pending inserts tracking)
 * @param skipExistingCheck - If true, assumes persons don't exist yet (faster for initial seeding)
 */
export async function batchAddPersons(persons: PersonInput[], isNew: boolean = false, skipExistingCheck: boolean = true): Promise<number> {
    if (!storage.isAvailable() || !persons || persons.length === 0) return 0;
    try {
        // If we need to check existing state, fetch all current person data first
        let existingPersons: Map<string, StoredPerson> = new Map();
        if (!skipExistingCheck) {
            const ids = persons.map(p => p.id?.toString()).filter(Boolean) as string[];
            if (ids.length > 0) {
                const pipeline = storage.pipeline();
                for (const id of ids) {
                    pipeline.hget('person', id);
                }
                const results = await pipeline.exec() as [Error | null, string | null][];
                for (let i = 0; i < ids.length; i++) {
                    const [err, json] = results[i];
                    if (!err && json) {
                        try {
                            existingPersons.set(ids[i], JSON.parse(json) as StoredPerson);
                        } catch { /* ignore parse error */ }
                    }
                }
            }
        }

        const pipeline = storage.pipeline();
        let maleCount = 0;
        let femaleCount = 0;
        let newCount = 0;

        for (const person of persons) {
            if (!person || person.id === undefined || person.id === null) continue;

            const id = person.id.toString();
            const existing = existingPersons.get(id);

            const p: StoredPerson = {
                id: person.id,
                tile_id: person.tile_id ?? null,
                sex: person.sex ?? false,
                health: person.health || 100,
                date_of_birth: person.date_of_birth ?? '',
                family_id: person.family_id || null,
                _isNew: isNew
            };

            pipeline.hset('person', id, JSON.stringify(p));

            if (!existing) {
                newCount++;
            }

            if (checkIsMale(p.sex)) maleCount++;
            else femaleCount++;

            if (isNew) {
                pipeline.sadd('pending:person:inserts', id);
            }
        }

        // Only increment counts for truly new persons
        if (skipExistingCheck) {
            pipeline.hincrby('counts:global', 'total', persons.length);
        } else if (newCount > 0) {
            pipeline.hincrby('counts:global', 'total', newCount);
        }
        if (maleCount > 0) pipeline.hincrby('counts:global', 'male', maleCount);
        if (femaleCount > 0) pipeline.hincrby('counts:global', 'female', femaleCount);

        await pipeline.exec();
        return persons.length;
    } catch (err: unknown) {
        console.warn('[BatchOperations] batchAddPersons failed:', getErrorMessage(err));
        return 0;
    }
}

/**
 * Reassign temporary IDs to Postgres IDs after batch insert
 */
export async function reassignIds(mappings: IdMapping[]): Promise<void> {
    if (!storage.isAvailable()) return;
    try {
        const readPipeline = storage.pipeline();
        for (const { tempId } of mappings) {
            readPipeline.hget('person', tempId.toString());
        }
        const readResults = await readPipeline.exec() as PipelineResult;

        const writePipeline = storage.pipeline();
        for (let i = 0; i < mappings.length; i++) {
            const { tempId, newId } = mappings[i];
            const [err, json] = readResults[i];
            if (err || !json) continue;

            let person: StoredPerson & { _isNew?: boolean };
            try { person = JSON.parse(json as string) as StoredPerson; } catch { continue; }

            writePipeline.hdel('person', tempId.toString());

            if (person.tile_id) {
                const setKey = checkIsMale(person.sex) ? `eligible:males:tile:${person.tile_id}` : `eligible:females:tile:${person.tile_id}`;
                writePipeline.srem(setKey, tempId.toString());
                if (!person.family_id) {
                    writePipeline.sadd(setKey, newId.toString());
                }
            }

            person.id = newId;
            delete person._isNew;
            writePipeline.hset('person', newId.toString(), JSON.stringify(person));
        }

        await writePipeline.exec();

        const delPipeline = storage.pipeline();
        for (const { tempId } of mappings) {
            delPipeline.srem('pending:person:inserts', tempId.toString());
        }
        await delPipeline.exec();
    } catch (err: unknown) {
        console.warn('[BatchOperations] reassignIds failed:', getErrorMessage(err));
    }
}
