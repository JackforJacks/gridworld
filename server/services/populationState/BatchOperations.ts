/**
 * BatchOperations - Batch CRUD operations for people
 * 
 * Handles:
 * - batchAddPersons, batchRemovePersons
 * - batchUpdateResidency, batchClearFamilyIds
 * - batchDeleteFamilies
 * - reassignIds
 */

import storage from '../storage';
import { 
    StoredPerson, 
    PersonInput, 
    PipelineResult, 
    ResidencyUpdate, 
    IdMapping,
    getErrorMessage 
} from './types';

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

            if (person.tile_id && person.residency !== null && person.residency !== undefined) {
                removePipeline.srem(`village:${person.tile_id}:${person.residency}:people`, personIdStr);
            }

            removePipeline.hincrby('counts:global', 'total', -1);
            if (person.sex === true) removePipeline.hincrby('counts:global', 'male', -1);
            else if (person.sex === false) removePipeline.hincrby('counts:global', 'female', -1);

            if (person.tile_id) {
                const sex = person.sex === true ? 'male' : 'female';
                removePipeline.srem(`eligible:${sex}:${person.tile_id}`, personIdStr);
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
 */
export async function batchAddPersons(persons: PersonInput[], isNew: boolean = false): Promise<number> {
    if (!storage.isAvailable() || !persons || persons.length === 0) return 0;
    try {
        const pipeline = storage.pipeline();
        let maleCount = 0;
        let femaleCount = 0;

        for (const person of persons) {
            if (!person || person.id === undefined || person.id === null) continue;

            const id = person.id.toString();
            const p: StoredPerson = {
                id: person.id,
                tile_id: person.tile_id ?? null,
                residency: person.residency ?? null,
                sex: person.sex ?? false,
                health: person.health || 100,
                date_of_birth: person.date_of_birth ?? '',
                family_id: person.family_id || null,
                _isNew: isNew
            };

            pipeline.hset('person', id, JSON.stringify(p));

            if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                pipeline.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
            }

            if (p.sex === true) maleCount++;
            else if (p.sex === false) femaleCount++;

            if (isNew) {
                pipeline.sadd('pending:person:inserts', id);
            }
        }

        pipeline.hincrby('counts:global', 'total', persons.length);
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
 * Batch update residency for multiple persons
 */
export async function batchUpdateResidency(updates: ResidencyUpdate[]): Promise<number> {
    if (!storage.isAvailable() || !updates || updates.length === 0) return 0;
    try {
        const readPipeline = storage.pipeline();
        for (const { personId } of updates) {
            readPipeline.hget('person', personId.toString());
        }
        const readResults = await readPipeline.exec() as PipelineResult;

        const writePipeline = storage.pipeline();
        let updateCount = 0;

        for (let i = 0; i < updates.length; i++) {
            const { personId, newResidency } = updates[i];
            const [err, json] = readResults[i];
            if (err || !json) continue;

            let person: StoredPerson;
            try { person = JSON.parse(json as string) as StoredPerson; } catch { continue; }

            const oldTileId = person.tile_id;
            const oldResidency = person.residency;

            person.residency = newResidency;
            writePipeline.hset('person', personId.toString(), JSON.stringify(person));

            if (oldResidency !== newResidency) {
                if (oldTileId && oldResidency !== null && oldResidency !== undefined) {
                    writePipeline.srem(`village:${oldTileId}:${oldResidency}:people`, personId.toString());
                }
                if (oldTileId && newResidency !== null && newResidency !== undefined) {
                    writePipeline.sadd(`village:${oldTileId}:${newResidency}:people`, personId.toString());
                }
            }

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
        console.warn('[BatchOperations] batchUpdateResidency failed:', getErrorMessage(err));
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
            
            if (person.tile_id && person.residency !== null && person.residency !== undefined) {
                writePipeline.srem(`village:${person.tile_id}:${person.residency}:people`, tempId.toString());
                writePipeline.sadd(`village:${person.tile_id}:${person.residency}:people`, newId.toString());
            }
            
            const sex = person.sex === true ? 'male' : 'female';
            if (person.tile_id) {
                writePipeline.srem(`eligible:${sex}:${person.tile_id}`, tempId.toString());
                if (!person.family_id) {
                    writePipeline.sadd(`eligible:${sex}:${person.tile_id}`, newId.toString());
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
