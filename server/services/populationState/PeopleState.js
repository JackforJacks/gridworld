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

const { isRedisAvailable, getRedis, getPool } = require('./redisHelpers');

class PeopleState {
    static nextTempId = -1;

    /**
     * Get a new temporary ID for a person created in Redis-only mode
     */
    static async getNextTempId() {
        const redis = getRedis();
        if (!isRedisAvailable()) return this.nextTempId--;
        try {
            const id = await redis.hincrby('counts:global', 'nextTempId', -1);
            return id;
        } catch (err) {
            return this.nextTempId--;
        }
    }

    /**
     * Add a person to Redis
     * @param {Object} person - { id, tile_id, residency, sex, date_of_birth, family_id }
     * @param {boolean} isNew - If true, track as pending insert
     */
    static async addPerson(person, isNew = false) {
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
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
            await redis.hset('person', id, JSON.stringify(p));
            // Add to tile's village population set
            if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                await redis.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
            }
            // Update global counts
            await redis.hincrby('counts:global', 'total', 1);
            if (p.sex === true) await redis.hincrby('counts:global', 'male', 1);
            else if (p.sex === false) await redis.hincrby('counts:global', 'female', 1);

            if (isNew) {
                await redis.sadd('pending:person:inserts', id);
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
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
        try {
            const json = await redis.hget('person', personId.toString());
            if (!json) return false;
            const p = JSON.parse(json);

            // Remove from tile's village population set
            if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                await redis.srem(`village:${p.tile_id}:${p.residency}:people`, personId.toString());
            }

            // Decrement global counts
            await redis.hincrby('counts:global', 'total', -1);
            if (p.sex === true) await redis.hincrby('counts:global', 'male', -1);
            else if (p.sex === false) await redis.hincrby('counts:global', 'female', -1);

            // Remove from eligible sets if present
            await this.removeEligiblePerson(personId);

            await redis.hdel('person', personId.toString());

            if (markDeleted && personId > 0) {
                // Only mark positive IDs for Postgres deletion
                await redis.sadd('pending:person:deletes', personId.toString());
            }
            // If it's a temp ID, remove from pending inserts
            if (personId < 0) {
                await redis.srem('pending:person:inserts', personId.toString());
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
        const redis = getRedis();
        if (!isRedisAvailable()) return null;
        const json = await redis.hget('person', personId.toString());
        return json ? JSON.parse(json) : null;
    }

    /**
     * Update a person in Redis
     */
    static async updatePerson(personId, updates) {
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
        try {
            const person = await this.getPerson(personId);
            if (!person) return false;

            const oldTileId = person.tile_id;
            const oldResidency = person.residency;

            const updated = { ...person, ...updates };
            await redis.hset('person', personId.toString(), JSON.stringify(updated));

            // Handle tile/residency change: update village sets
            if ((updates.tile_id !== undefined && updates.tile_id !== oldTileId) ||
                (updates.residency !== undefined && updates.residency !== oldResidency)) {
                // Remove from old set
                if (oldTileId && oldResidency !== null && oldResidency !== undefined) {
                    await redis.srem(`village:${oldTileId}:${oldResidency}:people`, personId.toString());
                }
                // Add to new set
                const newTile = updates.tile_id !== undefined ? updates.tile_id : oldTileId;
                const newRes = updates.residency !== undefined ? updates.residency : oldResidency;
                if (newTile && newRes !== null && newRes !== undefined) {
                    await redis.sadd(`village:${newTile}:${newRes}:people`, personId.toString());
                }
            }

            // Track modified people for batch update (only for existing Postgres records)
            if (personId > 0 && !person._isNew) {
                await redis.sadd('pending:person:updates', personId.toString());
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
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        const data = await redis.hgetall('person');
        return Object.values(data).map(json => JSON.parse(json));
    }

    /**
     * Get people by tile and residency (village)
     */
    static async getTilePopulation(tileId, residency) {
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers(`village:${tileId}:${residency}:people`);
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = redis.pipeline();
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
        const redis = getRedis();
        if (!isRedisAvailable()) return { total: 0, male: 0, female: 0 };
        const counts = await redis.hgetall('counts:global');
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
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
        try {
            const sex = isMale ? 'male' : 'female';
            await redis.sadd(`eligible:${sex}:${tileId}`, personId.toString());
            return true;
        } catch (err) {
            console.warn('[PeopleState] addEligiblePerson failed:', err.message);
            return false;
        }
    }

    /**
     * Remove person from all eligible sets
     */
    static async removeEligiblePerson(personId) {
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
        try {
            // We need to find and remove from eligible sets
            // Scan for keys matching eligible:*:*
            const stream = redis.scanStream({ match: 'eligible:*:*', count: 100 });
            for await (const keys of stream) {
                for (const key of keys) {
                    await redis.srem(key, personId.toString());
                }
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
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        const sex = isMale ? 'male' : 'female';
        return redis.smembers(`eligible:${sex}:${tileId}`);
    }

    // =========== PENDING OPERATIONS ===========

    /**
     * Get pending person inserts (people with temp IDs)
     */
    static async getPendingInserts() {
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:person:inserts');
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = redis.pipeline();
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
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:person:updates');
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = redis.pipeline();
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
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:person:deletes');
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
        const redis = getRedis();
        if (!isRedisAvailable()) return;
        try {
            await redis.del('pending:person:inserts');
            await redis.del('pending:person:updates');
            await redis.del('pending:person:deletes');
        } catch (err) {
            console.warn('[PeopleState] clearPendingOperations failed:', err.message);
        }
    }

    /**
     * Reassign temporary IDs to Postgres IDs after batch insert
     * @param {Array} mappings - Array of { tempId, newId }
     */
    static async reassignIds(mappings) {
        const redis = getRedis();
        if (!isRedisAvailable()) return;
        try {
            // First, batch-read all temp people using pipeline
            const readPipeline = redis.pipeline();
            for (const { tempId } of mappings) {
                readPipeline.hget('person', tempId.toString());
            }
            const readResults = await readPipeline.exec();

            // Parse results and prepare write operations
            const writePipeline = redis.pipeline();
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
            const delPipeline = redis.pipeline();
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
        const redis = getRedis();
        if (!isRedisAvailable()) return {};
        try {
            const result = {};
            const stream = redis.scanStream({ match: 'village:*:*:people', count: 100 });
            for await (const keys of stream) {
                for (const key of keys) {
                    const parts = key.split(':');
                    if (parts.length === 4) {
                        const tileId = parseInt(parts[1]);
                        const count = await redis.scard(key);
                        result[tileId] = (result[tileId] || 0) + count;
                    }
                }
            }
            return result;
        } catch (err) {
            console.warn('[PeopleState] getAllTilePopulations failed:', err.message);
            return {};
        }
    }

    /**
     * Get demographic statistics
     * @param {Object} currentDate - { year, month, day }
     */
    static async getDemographicStats(currentDate) {
        const redis = getRedis();
        if (!isRedisAvailable()) return null;
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

                    if (age < 18) {
                        minors++;
                    } else if (age >= 65) {
                        elderly++;
                    } else {
                        working_age++;
                    }

                    // Bachelors: unmarried adults (male 18-45, female 18-30)
                    if (!p.family_id) {
                        if (p.sex === true && age >= 18 && age <= 45) {
                            bachelors++;
                        } else if (p.sex === false && age >= 18 && age <= 30) {
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
        const redis = getRedis();
        const pool = getPool();
        if (!isRedisAvailable()) return { skipped: true, reason: 'Redis not available' };
        try {
            console.log('[PeopleState] Syncing population from Postgres to Redis...');
            // Clear person hash and all village sets keys that match our pattern
            try {
                await redis.del('person');
                // Clear all village:*:people sets by scanning keys
                const stream = redis.scanStream({ match: 'village:*:*:people', count: 1000 });
                const keys = [];
                for await (const resultKeys of stream) {
                    for (const key of resultKeys) keys.push(key);
                }
                if (keys.length > 0) await redis.del(...keys);
                await redis.del('counts:global');
                console.log('[PeopleState] Cleared Redis population keys');
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
                const pipeline = redis.pipeline();
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
            await redis.hset('counts:global', 'total', total.toString());
            await redis.hset('counts:global', 'male', maleCount.toString());
            await redis.hset('counts:global', 'female', femaleCount.toString());

            console.log(`[PeopleState] Synced ${total} people to Redis (${maleCount} male, ${femaleCount} female)`);
            return { success: true, total, male: maleCount, female: femaleCount };
        } catch (err) {
            console.error('[PeopleState] syncFromPostgres failed:', err.message);
            throw err;
        }
    }
}

module.exports = PeopleState;
