/**
 * PeopleState - Redis state management for individual people
 * 
 * Handles:
 * - Person CRUD operations
 * - Pending insert/delete tracking
 * - ID reassignment after Postgres sync
 * - Eligible matchmaking sets
 * - Global and tile population counts
 * - Demographic statistics
 */

const storage = require('../storage');
const pool = require('../../config/database');
const { acquireLock, releaseLock } = require('../../utils/lock');
const idAllocator = require('../idAllocator');

class PeopleState {
    /**
     * Get the next real Postgres ID for a new person
     * IDs are pre-allocated from Postgres sequences, so they're valid for direct insert later
     */
    static async getNextId() {
        return idAllocator.getNextPersonId();
    }

    /**
     * Get a batch of real Postgres IDs for multiple new people
     * @param {number} count - Number of IDs needed
     * @returns {Promise<number[]>}
     */
    static async getIdBatch(count) {
        return idAllocator.getPersonIdBatch(count);
    }

    /**
     * Add a person to Redis
     * @param {Object} person - { id, tile_id, residency, sex, date_of_birth, family_id }
     * @param {boolean} isNew - If true, track as pending insert
     */
    static async addPerson(person, isNew = false) {
        if (!storage.isAvailable()) {
            console.warn('[PeopleState] addPerson failed: storage not available');
            return false;
        }
        if (!person || person.id === undefined || person.id === null) {
            console.warn('[PeopleState] addPerson failed: person.id is missing or undefined:', person);
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
            const hsetResult = await storage.hset('person', id, JSON.stringify(p));
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
        } catch (err) {
            console.warn('[PeopleState] addPerson failed:', err.message);
            return false;
        }
    }

    /**
     * Remove a person from Redis
     * @param {number} personId
     * @param {boolean} markDeleted - If true, track for Postgres deletion
     */
    static async removePerson(personId, markDeleted = false) {
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
            await this.removeEligiblePerson(personId);

            await storage.hdel('person', personId.toString());

            if (markDeleted && personId > 0) {
                // Only mark positive IDs for Postgres deletion
                await storage.sadd('pending:person:deletes', personId.toString());
            }
            // If it's a temp ID, remove from pending inserts
            if (personId < 0) {
                await storage.srem('pending:person:inserts', personId.toString());
            }

            return true;
        } catch (err) {
            console.warn('[PeopleState] removePerson failed:', err.message);
            return false;
        }
    }

    /**
     * Get a person from Redis
     */
    static async getPerson(personId) {
        if (!storage.isAvailable()) return null;
        const json = await storage.hget('person', personId.toString());
        return json ? JSON.parse(json) : null;
    }

    /**
     * Update a person in Redis
     */
    static async updatePerson(personId, updates) {
        if (!storage.isAvailable()) return false;
        try {
            const person = await this.getPerson(personId);
            if (!person) return false;

            const oldTileId = person.tile_id;
            const oldResidency = person.residency;

            const updated = { ...person, ...updates };
            await storage.hset('person', personId.toString(), JSON.stringify(updated));

            // Handle tile/residency change: update village sets
            if ((updates.tile_id !== undefined && updates.tile_id !== oldTileId) ||
                (updates.residency !== undefined && updates.residency !== oldResidency)) {
                // Remove from old set
                if (oldTileId && oldResidency !== null && oldResidency !== undefined) {
                    await storage.srem(`village:${oldTileId}:${oldResidency}:people`, personId.toString());
                }
                // Add to new set
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
        } catch (err) {
            console.warn('[PeopleState] updatePerson failed:', err.message);
            return false;
        }
    }

    /**
     * Get all people from Redis
     */
    static async getAllPeople() {
        if (!storage.isAvailable()) return [];
        const data = await storage.hgetall('person');
        return Object.values(data).map(json => JSON.parse(json));
    }

    /**
     * Get people by tile and residency (village)
     */
    static async getTilePopulation(tileId, residency) {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers(`village:${tileId}:${residency}:people`);
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = storage.pipeline();
            for (const id of ids) {
                pipeline.hget('person', id);
            }
            const results = await pipeline.exec();

            const people = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    try {
                        people.push(JSON.parse(json));
                    } catch (e) { /* skip invalid JSON */ }
                }
            }
            return people;
        } catch (err) {
            console.warn('[PeopleState] getTilePopulation failed:', err.message);
            return [];
        }
    }

    /**
     * Get global counts from Redis
     */
    static async getGlobalCounts() {
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
    static async getTotalPopulation() {
        const counts = await this.getGlobalCounts();
        return counts.total;
    }

    // =========== ELIGIBLE MATCHMAKING SETS ===========

    /**
     * Add person to eligible set (for matchmaking)
     * @param {number} personId
     * @param {boolean} isMale
     * @param {number} tileId
     */
    static async addEligiblePerson(personId, isMale, tileId) {
        if (!storage.isAvailable()) return false;
        try {
            const sex = isMale ? 'male' : 'female';
            await storage.sadd(`eligible:${sex}:${tileId}`, personId.toString());
            return true;
        } catch (err) {
            console.warn('[PeopleState] addEligiblePerson failed:', err.message);
            return false;
        }
    }

    /**
     * Remove person from all eligible sets
     * Optimized: Uses pipeline to batch srem operations
     */
    static async removeEligiblePerson(personId) {
        if (!storage.isAvailable()) return false;
        try {
            const personIdStr = personId.toString();
            // Collect all keys first, then batch remove
            const stream = storage.scanStream({ match: 'eligible:*:*', count: 100 });
            for await (const keys of stream) {
                if (keys.length === 0) continue;
                // Use pipeline to batch all srem operations for this chunk
                const pipeline = storage.pipeline();
                for (const key of keys) {
                    pipeline.srem(key, personIdStr);
                }
                await pipeline.exec();
            }
            return true;
        } catch (err) {
            console.warn('[PeopleState] removeEligiblePerson failed:', err.message);
            return false;
        }
    }

    /**
     * Get all eligible people for a sex and tile
     */
    static async getEligiblePeople(isMale, tileId) {
        if (!storage.isAvailable()) return [];
        const sex = isMale ? 'male' : 'female';
        return storage.smembers(`eligible:${sex}:${tileId}`);
    }

    // =========== PENDING OPERATIONS ===========

    /**
     * Get pending person inserts (people with temp IDs)
     */
    static async getPendingInserts() {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers('pending:person:inserts');
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = storage.pipeline();
            for (const id of ids) {
                pipeline.hget('person', id.toString());
            }
            const results = await pipeline.exec();

            const people = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    try {
                        people.push(JSON.parse(json));
                    } catch (e) { /* skip invalid JSON */ }
                }
            }
            return people;
        } catch (err) {
            console.warn('[PeopleState] getPendingInserts failed:', err.message);
            return [];
        }
    }

    /**
     * Get pending person updates (people that were modified)
     */
    static async getPendingUpdates() {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers('pending:person:updates');
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = storage.pipeline();
            for (const id of ids) {
                pipeline.hget('person', id.toString());
            }
            const results = await pipeline.exec();

            const people = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    try {
                        people.push(JSON.parse(json));
                    } catch (e) { /* skip invalid JSON */ }
                }
            }
            return people;
        } catch (err) {
            console.warn('[PeopleState] getPendingUpdates failed:', err.message);
            return [];
        }
    }

    /**
     * Get pending person deletes
     */
    static async getPendingDeletes() {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers('pending:person:deletes');
            return ids.map(id => parseInt(id));
        } catch (err) {
            console.warn('[PeopleState] getPendingDeletes failed:', err.message);
            return [];
        }
    }

    /**
     * Clear pending person operations
     */
    static async clearPendingOperations() {
        if (!storage.isAvailable()) return;
        try {
            await storage.del('pending:person:inserts');
            await storage.del('pending:person:updates');
            await storage.del('pending:person:deletes');
        } catch (err) {
            console.warn('[PeopleState] clearPendingOperations failed:', err.message);
        }
    }

    // =========== BATCH OPERATIONS (OPTIMIZED) ===========

    /**
     * Batch clear family_id for multiple persons
     * Optimized: Uses pipeline to batch all updates
     * @param {Array<number>} personIds - Array of person IDs to update
     * @returns {Promise<number>} Number of successfully updated persons
     */
    static async batchClearFamilyIds(personIds) {
        if (!storage.isAvailable() || !personIds || personIds.length === 0) return 0;
        try {
            // First, batch-read all persons using pipeline
            const readPipeline = storage.pipeline();
            for (const personId of personIds) {
                readPipeline.hget('person', personId.toString());
            }
            const readResults = await readPipeline.exec();

            // Prepare write operations
            const writePipeline = storage.pipeline();
            let updateCount = 0;

            for (let i = 0; i < personIds.length; i++) {
                const personId = personIds[i];
                const [err, json] = readResults[i];
                if (err || !json) continue;

                let person;
                try { person = JSON.parse(json); } catch { continue; }

                // Update person with cleared family_id
                person.family_id = null;
                writePipeline.hset('person', personId.toString(), JSON.stringify(person));

                // Track modified people for batch update (only for existing Postgres records)
                if (personId > 0 && !person._isNew) {
                    writePipeline.sadd('pending:person:updates', personId.toString());
                }
                updateCount++;
            }

            if (updateCount > 0) {
                await writePipeline.exec();
            }
            return updateCount;
        } catch (err) {
            console.warn('[PeopleState] batchClearFamilyIds failed:', err.message);
            return 0;
        }
    }

    /**
     * Batch remove persons from Redis
     * Optimized: Uses pipeline to batch all remove operations
     * @param {Array<number>} personIds - Array of person IDs to remove
     * @param {boolean} markDeleted - If true, track for Postgres deletion
     * @returns {Promise<number>} Number of successfully removed persons
     */
    static async batchRemovePersons(personIds, markDeleted = false) {
        if (!storage.isAvailable() || !personIds || personIds.length === 0) return 0;
        try {
            // First, batch-read all persons using pipeline to get their data
            const readPipeline = storage.pipeline();
            for (const personId of personIds) {
                readPipeline.hget('person', personId.toString());
            }
            const readResults = await readPipeline.exec();

            // Collect all eligible keys to remove from (we'll batch this separately)
            const eligibleKeysToCheck = new Set();
            const personsData = [];

            for (let i = 0; i < personIds.length; i++) {
                const personId = personIds[i];
                const [err, json] = readResults[i];
                if (err || !json) continue;

                let person;
                try { person = JSON.parse(json); } catch { continue; }
                personsData.push({ personId, person });
            }

            // Prepare main removal pipeline
            const removePipeline = storage.pipeline();

            for (const { personId, person } of personsData) {
                const personIdStr = personId.toString();

                // Remove from tile's village population set
                if (person.tile_id && person.residency !== null && person.residency !== undefined) {
                    removePipeline.srem(`village:${person.tile_id}:${person.residency}:people`, personIdStr);
                }

                // Decrement global counts
                removePipeline.hincrby('counts:global', 'total', -1);
                if (person.sex === true) removePipeline.hincrby('counts:global', 'male', -1);
                else if (person.sex === false) removePipeline.hincrby('counts:global', 'female', -1);

                // Remove from eligible sets (we know the person's tile and sex)
                if (person.tile_id) {
                    const sex = person.sex === true ? 'male' : 'female';
                    removePipeline.srem(`eligible:${sex}:${person.tile_id}`, personIdStr);
                }

                // Delete the person record
                removePipeline.hdel('person', personIdStr);

                // Track for Postgres deletion or remove from pending inserts
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
        } catch (err) {
            console.warn('[PeopleState] batchRemovePersons failed:', err.message);
            return 0;
        }
    }

    /**
     * Batch delete families from Redis
     * Optimized: Uses pipeline to batch all delete operations
     * @param {Array<number>} familyIds - Array of family IDs to delete
     * @param {boolean} markDeleted - If true, track positive IDs for Postgres deletion
     * @returns {Promise<number>} Number of families deleted
     */
    static async batchDeleteFamilies(familyIds, markDeleted = false) {
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
        } catch (err) {
            console.warn('[PeopleState] batchDeleteFamilies failed:', err.message);
            return 0;
        }
    }

    /**
     * Batch add persons to Redis
     * Optimized: Uses pipeline to batch all add operations
     * @param {Array<Object>} persons - Array of person objects
     * @param {boolean} isNew - If true, track as pending inserts
     * @returns {Promise<number>} Number of persons added
     */
    static async batchAddPersons(persons, isNew = false) {
        if (!storage.isAvailable() || !persons || persons.length === 0) return 0;
        try {
            const pipeline = storage.pipeline();
            let maleCount = 0;
            let femaleCount = 0;

            for (const person of persons) {
                if (!person || person.id === undefined || person.id === null) continue;

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

                pipeline.hset('person', id, JSON.stringify(p));

                // Add to tile's village population set
                if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                    pipeline.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
                }

                // Track counts
                if (p.sex === true) maleCount++;
                else if (p.sex === false) femaleCount++;

                if (isNew) {
                    pipeline.sadd('pending:person:inserts', id);
                }
            }

            // Batch update global counts
            pipeline.hincrby('counts:global', 'total', persons.length);
            if (maleCount > 0) pipeline.hincrby('counts:global', 'male', maleCount);
            if (femaleCount > 0) pipeline.hincrby('counts:global', 'female', femaleCount);

            await pipeline.exec();
            return persons.length;
        } catch (err) {
            console.warn('[PeopleState] batchAddPersons failed:', err.message);
            return 0;
        }
    }

    /**
     * Batch update residency for multiple persons
     * Optimized: Uses pipeline for all updates
     * @param {Array<{personId: number, newResidency: number}>} updates - Array of updates
     * @returns {Promise<number>} Number of persons updated
     */
    static async batchUpdateResidency(updates) {
        if (!storage.isAvailable() || !updates || updates.length === 0) return 0;
        try {
            // First, batch-read all persons
            const readPipeline = storage.pipeline();
            for (const { personId } of updates) {
                readPipeline.hget('person', personId.toString());
            }
            const readResults = await readPipeline.exec();

            // Prepare write operations
            const writePipeline = storage.pipeline();
            let updateCount = 0;

            for (let i = 0; i < updates.length; i++) {
                const { personId, newResidency } = updates[i];
                const [err, json] = readResults[i];
                if (err || !json) continue;

                let person;
                try { person = JSON.parse(json); } catch { continue; }

                const oldTileId = person.tile_id;
                const oldResidency = person.residency;

                // Update person
                person.residency = newResidency;
                writePipeline.hset('person', personId.toString(), JSON.stringify(person));

                // Update village sets if residency changed
                if (oldResidency !== newResidency) {
                    if (oldTileId && oldResidency !== null && oldResidency !== undefined) {
                        writePipeline.srem(`village:${oldTileId}:${oldResidency}:people`, personId.toString());
                    }
                    if (oldTileId && newResidency !== null && newResidency !== undefined) {
                        writePipeline.sadd(`village:${oldTileId}:${newResidency}:people`, personId.toString());
                    }
                }

                // Track for pending updates
                if (personId > 0 && !person._isNew) {
                    writePipeline.sadd('pending:person:updates', personId.toString());
                }
                updateCount++;
            }

            if (updateCount > 0) {
                await writePipeline.exec();
            }
            return updateCount;
        } catch (err) {
            console.warn('[PeopleState] batchUpdateResidency failed:', err.message);
            return 0;
        }
    }

    /**
     * Reassign temporary IDs to Postgres IDs after batch insert
     * @param {Array} mappings - Array of { tempId, newId }
     */
    static async reassignIds(mappings) {
        if (!storage.isAvailable()) return;
        try {
            // First, batch-read all temp people using pipeline
            const readPipeline = storage.pipeline();
            for (const { tempId } of mappings) {
                readPipeline.hget('person', tempId.toString());
            }
            const readResults = await readPipeline.exec();

            // Parse results and prepare write operations
            const writePipeline = storage.pipeline();
            for (let i = 0; i < mappings.length; i++) {
                const { tempId, newId } = mappings[i];
                const [err, json] = readResults[i];
                if (err || !json) continue;

                let person;
                try { person = JSON.parse(json); } catch { continue; }

                // Remove old entry
                writePipeline.hdel('person', tempId.toString());
                // Update village set
                if (person.tile_id && person.residency !== null && person.residency !== undefined) {
                    writePipeline.srem(`village:${person.tile_id}:${person.residency}:people`, tempId.toString());
                    writePipeline.sadd(`village:${person.tile_id}:${person.residency}:people`, newId.toString());
                }
                // Update eligible sets
                const sex = person.sex === true ? 'male' : 'female';
                if (person.tile_id) {
                    writePipeline.srem(`eligible:${sex}:${person.tile_id}`, tempId.toString());
                    // Only re-add if they're still eligible (no family)
                    if (!person.family_id) {
                        writePipeline.sadd(`eligible:${sex}:${person.tile_id}`, newId.toString());
                    }
                }
                // Add with new ID
                person.id = newId;
                delete person._isNew;
                writePipeline.hset('person', newId.toString(), JSON.stringify(person));
            }

            await writePipeline.exec();

            // Clear the pending inserts we just processed
            const delPipeline = storage.pipeline();
            for (const { tempId } of mappings) {
                delPipeline.srem('pending:person:inserts', tempId.toString());
            }
            await delPipeline.exec();
        } catch (err) {
            console.warn('[PeopleState] reassignIds failed:', err.message);
        }
    }

    // =========== DEMOGRAPHICS ===========

    /**
     * Get all populations by tile (for statistics)
     */
    static async getAllTilePopulations() {
        if (!storage.isAvailable()) return {};
        try {
            // We must count UNIQUE person IDs per tile. People can be members of multiple residency sets;
            // summing SCARD across residency sets will double-count the same person. Build a Set per tile.
            const tileSets = new Map(); // tileId -> Set of person IDs
            const stream = storage.scanStream({ match: 'village:*:*:people', count: 100 });

            // Handle the async iterator correctly
            for await (const keys of stream) {
                // keys should be an array, ensure it is
                if (!Array.isArray(keys)) continue;

                // Batch smembers for this chunk to reduce round trips
                const pipeline = storage.pipeline();
                for (const key of keys) pipeline.smembers(key);
                const results = await pipeline.exec();

                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    const parts = key.split(':');
                    if (parts.length !== 4) continue;
                    const tileId = parseInt(parts[1], 10);
                    const [err, members] = results[i];
                    if (err || !Array.isArray(members)) continue;

                    if (!tileSets.has(tileId)) tileSets.set(tileId, new Set());
                    const set = tileSets.get(tileId);
                    for (const id of members) set.add(id);
                }
            }

            const result = {};
            for (const [tileId, set] of tileSets.entries()) {
                const uniqueCount = set.size;
                result[tileId] = uniqueCount;
            }

            // Detect and warn if duplicates exist (sum of scards > unique counts)
            try {
                let totalScards = 0;
                let totalUnique = 0;
                const warnStream = storage.scanStream({ match: 'village:*:*:people', count: 100 });
                for await (const warnKeys of warnStream) {
                    if (!Array.isArray(warnKeys)) continue;
                    const pipeline = storage.pipeline();
                    for (const key of warnKeys) pipeline.scard(key);
                    const results = await pipeline.exec();
                    for (const [err, sc] of results) {
                        if (!err && typeof sc === 'number') totalScards += sc;
                    }
                }
                for (const set of tileSets.values()) totalUnique += set.size;
                if (totalScards > totalUnique) {
                    console.warn('[PeopleState] Duplicate memberships detected: total memberships=', totalScards, 'unique persons=', totalUnique);

                    // Diagnostic: find persons that appear in multiple village sets and log top samples
                    try {
                        const personMap = new Map(); // id -> Set of keys
                        const warnStream2 = storage.scanStream({ match: 'village:*:*:people', count: 100 });
                        for await (const keys2 of warnStream2) {
                            if (!Array.isArray(keys2)) continue;
                            for (const key of keys2) {
                                const members = await storage.smembers(key);
                                for (const m of members) {
                                    const id = String(m);
                                    if (!personMap.has(id)) personMap.set(id, new Set());
                                    personMap.get(id).add(key);
                                }
                            }
                        }

                        const duplicates = [];
                        for (const [id, set] of personMap.entries()) {
                            if (set.size > 1) duplicates.push({ id, sets: Array.from(set), count: set.size });
                        }

                        duplicates.sort((a, b) => b.count - a.count);
                        console.warn('[PeopleState] Diagnostic: duplicate persons count=', duplicates.length);
                        for (let i = 0; i < Math.min(20, duplicates.length); i++) {
                            const d = duplicates[i];
                            console.warn(`[PeopleState] Duplicate sample ${i + 1}: id=${d.id}, count=${d.count}, sets=${d.sets.join(', ')}`);
                        }

                        if (duplicates.length > 0) {
                            const sampleId = duplicates[0].id;
                            const personJson = await storage.hget('person', sampleId);
                            console.warn('[PeopleState] Sample duplicated person hash:', personJson);
                            try { console.warn('[PeopleState] Sample parsed:', JSON.parse(personJson)); } catch (_) { }
                        }
                    } catch (e) {
                        console.warn('[PeopleState] Duplicate diagnostic failed:', e && e.message ? e.message : e);
                    }
                }
            } catch (e) {
                /* best-effort warning - ignore errors */
            }

            return result;
        } catch (err) {
            console.warn('[PeopleState] getAllTilePopulations failed:', err.message || err);
            return {};
        }
    }

    /**
     * Get demographic statistics
     * @param {Object} currentDate - { year, month, day }
     */
    static async getDemographicStats(currentDate) {
        if (!storage.isAvailable()) return null;
        try {
            const people = await this.getAllPeople();
            const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;

            let male = 0, female = 0;
            let minors = 0, working_age = 0, elderly = 0;
            let bachelors = 0;

            for (const p of people) {
                // Sex counts
                if (p.sex === true) male++;
                else if (p.sex === false) female++;

                // Age calculations
                if (p.date_of_birth) {
                    let birthYear, birthMonth, birthDay;
                    if (typeof p.date_of_birth === 'string') {
                        const datePart = p.date_of_birth.split('T')[0];
                        [birthYear, birthMonth, birthDay] = datePart.split('-').map(Number);
                    } else if (p.date_of_birth instanceof Date) {
                        birthYear = p.date_of_birth.getFullYear();
                        birthMonth = p.date_of_birth.getMonth() + 1;
                        birthDay = p.date_of_birth.getDate();
                    } else {
                        continue; // Skip if can't parse
                    }

                    let age = currentYear - birthYear;
                    if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
                        age--;
                    }

                    if (age < 16) {
                        minors++;
                    } else if (age > 60) {
                        elderly++;
                    } else {
                        working_age++;
                    }

                    // Bachelors: unmarried adults (male 16-45, female 16-30)
                    if (!p.family_id) {
                        if (p.sex === true && age >= 16 && age <= 45) {
                            bachelors++;
                        } else if (p.sex === false && age >= 16 && age <= 30) {
                            bachelors++;
                        }
                    }
                }
            }

            return {
                totalPopulation: people.length,
                male,
                female,
                minors,
                working_age,
                elderly,
                bachelors
            };
        } catch (err) {
            console.error('[PeopleState] getDemographicStats failed:', err.message);
            return null;
        }
    }

    // =========== SYNC ===========

    /**
     * Full sync from Postgres: refill Redis person hash and village sets
     */
    static async syncFromPostgres() {
        if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

        const lockKey = 'population:sync:lock';
        const token = await acquireLock(lockKey, 30000, 5000);
        if (!token) {
            console.warn('[PeopleState] syncFromPostgres skipped: could not acquire sync lock');
            return { skipped: true, reason: 'could not acquire sync lock' };
        }

        try {
            console.log('[PeopleState] Syncing population from Postgres to storage...');
            // Clear person hash and all village sets keys that match our pattern
            try {
                console.log('[PeopleState.syncFromPostgres] About to delete person hash!');
                console.trace('[PeopleState.syncFromPostgres] Stack trace:');
                await storage.del('person');
                // Clear all village:*:people sets by scanning keys
                const stream = storage.scanStream({ match: 'village:*:*:people', count: 1000 });
                const keys = [];
                for await (const resultKeys of stream) {
                    for (const key of resultKeys) keys.push(key);
                }
                if (keys.length > 0) await storage.del(...keys);
                await storage.del('counts:global');
                console.log('[PeopleState] Cleared storage population keys');
            } catch (e) {
                console.warn('[PeopleState] Failed to clear Redis population keys:', e.message);
            }

            // Load people in batches to avoid memory pressure
            const batchSize = 10000;
            let offset = 0;
            let total = 0;
            let maleCount = 0, femaleCount = 0;

            while (true) {
                const res = await pool.query('SELECT id, tile_id, residency, sex, date_of_birth, family_id FROM people ORDER BY id LIMIT $1 OFFSET $2', [batchSize, offset]);
                if (!res.rows || res.rows.length === 0) break;
                const pipeline = storage.pipeline();
                for (const p of res.rows) {
                    const id = p.id.toString();
                    const personObj = {
                        id: p.id,
                        tile_id: p.tile_id,
                        residency: p.residency,
                        sex: p.sex,
                        health: 100,
                        date_of_birth: p.date_of_birth,
                        family_id: p.family_id
                    };
                    pipeline.hset('person', id, JSON.stringify(personObj));
                    if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                        pipeline.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
                    }
                    // Count demographics
                    if (p.sex === true) maleCount++;
                    else if (p.sex === false) femaleCount++;
                }
                await pipeline.exec();
                total += res.rows.length;
                offset += res.rows.length;
            }

            // Set demographic counters
            await storage.hset('counts:global', 'total', total.toString());
            await storage.hset('counts:global', 'male', maleCount.toString());
            await storage.hset('counts:global', 'female', femaleCount.toString());

            console.log(`[PeopleState] Synced ${total} people to storage (${maleCount} male, ${femaleCount} female)`);
            return { success: true, total, male: maleCount, female: femaleCount };
        } catch (err) {
            console.error('[PeopleState] syncFromPostgres failed:', err.message);
            throw err;
        }
    }

    /**
     * Rebuild village membership sets from the authoritative 'person' hash.
     * This clears all village:*:*:people sets then re-populates them from person records
     * ensuring each person appears only in the set matching their current tile_id/residency.
     */
    static async rebuildVillageMemberships() {
        if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

        const lockKey = 'population:sync:lock';
        const token = await acquireLock(lockKey, 30000, 5000);
        if (!token) {
            console.warn('[PeopleState] rebuildVillageMemberships skipped: could not acquire sync lock');
            return { skipped: true, reason: 'could not acquire sync lock' };
        }

        try {
            // Clear all village:*:*:people sets
            const stream = storage.scanStream({ match: 'village:*:*:people', count: 1000 });
            const keysToDelete = [];
            for await (const ks of stream) {
                for (const k of ks) keysToDelete.push(k);
            }
            if (keysToDelete.length > 0) await storage.del(...keysToDelete);

            // Read all persons and repopulate sets
            const peopleObj = await storage.hgetall('person');
            const ids = Object.keys(peopleObj || {});
            const pipeline = storage.pipeline();
            let total = 0;
            for (const id of ids) {
                const json = peopleObj[id];
                if (!json) continue;
                let person = null;
                try { person = JSON.parse(json); } catch (e) { continue; }
                if (person.tile_id && person.residency !== null && person.residency !== undefined) {
                    pipeline.sadd(`village:${person.tile_id}:${person.residency}:people`, id);
                    total++;
                }
            }
            await pipeline.exec();
            return { success: true, total };
        } catch (e) {
            console.warn('[PeopleState] rebuildVillageMemberships failed:', e && e.message ? e.message : e);
            return { success: false, error: e && e.message ? e.message : e };
        } finally {
            // release lock if held
            if (typeof token !== 'undefined' && token) {
                try { await releaseLock(lockKey, token); } catch (_) { }
            }
        }
    }

    /**
     * Quick integrity check and repair: if duplicate memberships detected, rebuild sets
     */
    static async repairIfNeeded() {
        if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

        const lockKey = 'population:sync:lock';
        const token = await acquireLock(lockKey, 30000, 5000);
        if (!token) {
            console.warn('[PeopleState] repairIfNeeded skipped: could not acquire sync lock');
            return { skipped: true, reason: 'could not acquire sync lock' };
        }

        try {
            // Quick scan: sum scard and count unique ids
            let totalScards = 0;
            const stream = storage.scanStream({ match: 'village:*:*:people', count: 100 });
            const keys = [];
            for await (const ks of stream) {
                for (const k of ks) keys.push(k);
            }
            if (keys.length === 0) return { ok: true, reason: 'no village sets' };
            const pipeline = storage.pipeline();
            for (const key of keys) pipeline.scard(key);
            const results = await pipeline.exec();
            for (const [err, sc] of results) {
                if (!err && typeof sc === 'number') totalScards += sc;
            }

            // Build unique count
            const personSet = new Set();
            for (const key of keys) {
                const members = await storage.smembers(key);
                for (const m of members) personSet.add(String(m));
            }
            const totalUnique = personSet.size;
            if (totalScards > totalUnique) {
                console.warn('[PeopleState] repairIfNeeded detected duplicate memberships: total=', totalScards, 'unique=', totalUnique);
                const res = await PeopleState.rebuildVillageMemberships();
                return { repaired: true, before: { totalScards, totalUnique }, result: res };
            }
            return { ok: true };
        } catch (e) {
            console.warn('[PeopleState] repairIfNeeded failed:', e && e.message ? e.message : e);
            return { ok: false, error: e && e.message ? e.message : e };
        } finally {
            if (token) {
                try { await releaseLock(lockKey, token); } catch (_) { }
            }
        }
    }
}

module.exports = PeopleState;
