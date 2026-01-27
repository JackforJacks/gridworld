const redis = require('../config/redis');
const { isRedisAvailable } = require('../config/redis');
const pool = require('../config/database');

class PopulationState {
    // Track next ID for new people created in Redis (not yet in Postgres)
    static nextTempId = -1; // Negative IDs indicate new records not yet in Postgres

    /**
     * Get a new temporary ID for a person created in Redis-only mode
     * These IDs are negative to distinguish from Postgres-assigned IDs
     */
    static async getNextTempId() {
        if (!isRedisAvailable()) return this.nextTempId--;
        try {
            // Use Redis to atomically decrement and get a unique negative ID
            const id = await redis.hincrby('counts:global', 'nextTempId', -1);
            return id;
        } catch (err) {
            return this.nextTempId--;
        }
    }

    /**
     * Initialize nextTempId from current min ID in Redis (call on load)
     */
    static async initTempIdCounter() {
        if (!isRedisAvailable()) return;
        try {
            // Start at -1 (or lower if we have existing negative IDs)
            await redis.hset('counts:global', 'nextTempId', '-1');
        } catch (err) {
            console.warn('[PopulationState] initTempIdCounter failed:', err.message);
        }
    }

    /**
     * Add a person to Redis and index them by village (best-effort)
     * Also updates demographic counters and tracks as pending insert if new
     * @param {Object} person - { id, tile_id, residency, sex, health?, date_of_birth?, family_id?, isNew? }
     * @param {boolean} isNew - If true, track as pending insert for Postgres batch
     */
    static async addPerson(person, isNew = false) {
        if (!isRedisAvailable()) return false;
        try {
            const id = person.id.toString();
            const p = {
                id: person.id,
                tile_id: person.tile_id || null,
                residency: person.residency ?? null,
                sex: person.sex ?? null,
                health: person.health ?? 100,
                date_of_birth: person.date_of_birth || null,
                family_id: person.family_id || null,
                _isNew: isNew // Internal flag to track pending inserts
            };
            await redis.hset('person', id, JSON.stringify(p));
            if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                await redis.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
            }
            // If this is a new person, track for batch insert
            if (isNew) {
                await redis.sadd('pending:inserts', id);
            }
            // Update demographic counters
            const pipeline = redis.pipeline();
            pipeline.hincrby('counts:global', 'total', 1);
            if (p.sex === true) {
                pipeline.hincrby('counts:global', 'male', 1);
            } else if (p.sex === false) {
                pipeline.hincrby('counts:global', 'female', 1);
            }
            await pipeline.exec();
            return true;
        } catch (err) {
            console.warn('[PopulationState] addPerson failed:', err.message);
            return false;
        }
    }

    /**
     * Remove a person from Redis and village index
     * Also updates demographic counters and tracks as pending delete
     * @param {number} personId
     * @param {boolean} trackForBatch - If true, track for batch delete in Postgres
     */
    static async removePerson(personId, trackForBatch = true) {
        if (!isRedisAvailable()) return false;
        try {
            const id = personId.toString();
            const json = await redis.hget('person', id);
            if (json) {
                const p = JSON.parse(json);
                if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                    await redis.srem(`village:${p.tile_id}:${p.residency}:people`, id);
                }
                await redis.hdel('person', id);
                
                // Track for batch delete if it was a Postgres record (positive ID)
                // Don't track negative IDs (temp records never saved to Postgres)
                if (trackForBatch && personId > 0) {
                    await redis.sadd('pending:deletes', id);
                }
                // If it was a pending insert, remove from that set
                await redis.srem('pending:inserts', id);
                
                // Update demographic counters
                const pipeline = redis.pipeline();
                pipeline.hincrby('counts:global', 'total', -1);
                if (p.sex === true) {
                    pipeline.hincrby('counts:global', 'male', -1);
                } else if (p.sex === false) {
                    pipeline.hincrby('counts:global', 'female', -1);
                }
                await pipeline.exec();
            }
            return true;
        } catch (err) {
            console.warn('[PopulationState] removePerson failed:', err.message);
            return false;
        }
    }

    static async getPerson(personId) {
        if (!isRedisAvailable()) return null;
        const json = await redis.hget('person', personId.toString());
        return json ? JSON.parse(json) : null;
    }

    /**
     * Update a person in Redis
     * @param {number} personId
     * @param {Object} updates - Fields to update
     */
    static async updatePerson(personId, updates) {
        if (!isRedisAvailable()) return false;
        try {
            const person = await this.getPerson(personId);
            if (!person) return false;
            const updated = { ...person, ...updates };
            await redis.hset('person', personId.toString(), JSON.stringify(updated));
            return true;
        } catch (err) {
            console.warn('[PopulationState] updatePerson failed:', err.message);
            return false;
        }
    }

    /**
     * Get all pending inserts (new people to be saved to Postgres)
     * Uses batch Redis reads for efficiency
     */
    static async getPendingInserts() {
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:inserts');
            if (ids.length === 0) return [];
            
            // Use pipeline to batch all reads
            const pipeline = redis.pipeline();
            for (const id of ids) {
                pipeline.hget('person', id);
            }
            const results = await pipeline.exec();
            
            const people = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    people.push(JSON.parse(json));
                }
            }
            return people;
        } catch (err) {
            console.warn('[PopulationState] getPendingInserts failed:', err.message);
            return [];
        }
    }

    /**
     * Get all pending deletes (people to be deleted from Postgres)
     */
    static async getPendingDeletes() {
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:deletes');
            return ids.map(id => parseInt(id));
        } catch (err) {
            console.warn('[PopulationState] getPendingDeletes failed:', err.message);
            return [];
        }
    }

    /**
     * Clear pending operations after successful save
     */
    static async clearPendingOperations() {
        if (!isRedisAvailable()) return;
        try {
            await redis.del('pending:inserts');
            await redis.del('pending:deletes');
        } catch (err) {
            console.warn('[PopulationState] clearPendingOperations failed:', err.message);
        }
    }

    /**
     * Reassign temporary IDs to Postgres IDs after batch insert
     * @param {Array} mappings - Array of { tempId, newId }
     */
    static async reassignIds(mappings) {
        if (!isRedisAvailable()) return;
        try {
            // First, batch-read all temp persons using pipeline
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
                if (person.tile_id && person.residency !== null) {
                    writePipeline.srem(`village:${person.tile_id}:${person.residency}:people`, tempId.toString());
                }
                
                // Add with new ID
                person.id = newId;
                delete person._isNew;
                writePipeline.hset('person', newId.toString(), JSON.stringify(person));
                if (person.tile_id && person.residency !== null) {
                    writePipeline.sadd(`village:${person.tile_id}:${person.residency}:people`, newId.toString());
                }
            }
            
            await writePipeline.exec();
        } catch (err) {
            console.warn('[PopulationState] reassignIds failed:', err.message);
        }
    }

    static async getAllPeople() {
        if (!isRedisAvailable()) return [];
        const data = await redis.hgetall('person');
        return Object.values(data).map(json => JSON.parse(json));
    }

    static async getTilePopulation(tileId, residency) {
        if (!isRedisAvailable()) return 0;
        return await redis.scard(`village:${tileId}:${residency}:people`);
    }

    static async getGlobalCounts() {
        if (!isRedisAvailable()) return { total: 0, male: 0, female: 0 };
        const all = await redis.hgetall('counts:global');
        const parsed = { total: 0, male: 0, female: 0 };
        for (const [k, v] of Object.entries(all)) parsed[k] = parseInt(v, 10) || 0;
        return parsed;
    }

    /**
     * Get demographic stats calculated from Redis person data
     * @param {string} currentDateStr - Current date in YYYY-MM-DD format for age calculations
     */
    static async getDemographicStats(currentDateStr) {
        if (!isRedisAvailable()) return null;
        try {
            const people = await this.getAllPeople();
            if (!people || people.length === 0) return null;

            // Parse current date
            const [currentYear, currentMonth, currentDay] = currentDateStr.split('-').map(Number);

            let male = 0, female = 0, minors = 0, working_age = 0, elderly = 0, bachelors = 0;

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
            console.error('[PopulationState] getDemographicStats failed:', err.message);
            return null;
        }
    }

    // =========== FAMILY MANAGEMENT (Redis-only) ===========
    
    static nextFamilyTempId = -1;

    /**
     * Get a new temporary ID for a family created in Redis-only mode
     */
    static async getNextFamilyTempId() {
        if (!isRedisAvailable()) return this.nextFamilyTempId--;
        try {
            const id = await redis.hincrby('counts:global', 'nextFamilyTempId', -1);
            return id;
        } catch (err) {
            return this.nextFamilyTempId--;
        }
    }

    /**
     * Add a family to Redis
     * @param {Object} family - { id, husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids }
     * @param {boolean} isNew - If true, track as pending insert
     */
    static async addFamily(family, isNew = false) {
        if (!isRedisAvailable()) return false;
        try {
            const id = family.id.toString();
            const f = {
                id: family.id,
                husband_id: family.husband_id,
                wife_id: family.wife_id,
                tile_id: family.tile_id,
                pregnancy: family.pregnancy || false,
                delivery_date: family.delivery_date || null,
                children_ids: family.children_ids || [],
                _isNew: isNew
            };
            await redis.hset('family', id, JSON.stringify(f));
            if (isNew) {
                await redis.sadd('pending:family:inserts', id);
            }
            return true;
        } catch (err) {
            console.warn('[PopulationState] addFamily failed:', err.message);
            return false;
        }
    }

    /**
     * Get a family from Redis
     */
    static async getFamily(familyId) {
        if (!isRedisAvailable()) return null;
        const json = await redis.hget('family', familyId.toString());
        return json ? JSON.parse(json) : null;
    }

    /**
     * Update a family in Redis
     */
    static async updateFamily(familyId, updates) {
        if (!isRedisAvailable()) return false;
        try {
            const family = await this.getFamily(familyId);
            if (!family) return false;
            const updated = { ...family, ...updates };
            await redis.hset('family', familyId.toString(), JSON.stringify(updated));
            // Track modified families for batch update (only for existing Postgres records)
            if (familyId > 0 && !family._isNew) {
                await redis.sadd('pending:family:updates', familyId.toString());
            }
            return true;
        } catch (err) {
            console.warn('[PopulationState] updateFamily failed:', err.message);
            return false;
        }
    }

    /**
     * Get all families from Redis
     */
    static async getAllFamilies() {
        if (!isRedisAvailable()) return [];
        const data = await redis.hgetall('family');
        return Object.values(data).map(json => JSON.parse(json));
    }

    /**
     * Get pending family inserts
     */
    static async getPendingFamilyInserts() {
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:family:inserts');
            if (ids.length === 0) return [];
            
            // Use pipeline for batch reads
            const pipeline = redis.pipeline();
            for (const id of ids) {
                pipeline.hget('family', id.toString());
            }
            const results = await pipeline.exec();
            
            const families = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    try {
                        families.push(JSON.parse(json));
                    } catch (e) { /* skip invalid JSON */ }
                }
            }
            return families;
        } catch (err) {
            console.warn('[PopulationState] getPendingFamilyInserts failed:', err.message);
            return [];
        }
    }

    /**
     * Get pending family updates (families that were modified)
     */
    static async getPendingFamilyUpdates() {
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:family:updates');
            if (ids.length === 0) return [];
            
            // Use pipeline for batch reads
            const pipeline = redis.pipeline();
            for (const id of ids) {
                pipeline.hget('family', id.toString());
            }
            const results = await pipeline.exec();
            
            const families = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    try {
                        families.push(JSON.parse(json));
                    } catch (e) { /* skip invalid JSON */ }
                }
            }
            return families;
        } catch (err) {
            console.warn('[PopulationState] getPendingFamilyUpdates failed:', err.message);
            return [];
        }
    }

    /**
     * Clear pending family operations
     */
    static async clearPendingFamilyOperations() {
        if (!isRedisAvailable()) return;
        try {
            await redis.del('pending:family:inserts');
            await redis.del('pending:family:updates');
            await redis.del('pending:family:deletes');
        } catch (err) {
            console.warn('[PopulationState] clearPendingFamilyOperations failed:', err.message);
        }
    }

    /**
     * Get pending family deletes
     */
    static async getPendingFamilyDeletes() {
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:family:deletes');
            return ids.map(id => parseInt(id));
        } catch (err) {
            console.warn('[PopulationState] getPendingFamilyDeletes failed:', err.message);
            return [];
        }
    }

    /**
     * Reassign temporary family IDs to Postgres IDs after batch insert
     * @param {Array} mappings - Array of { tempId, newId }
     */
    static async reassignFamilyIds(mappings) {
        if (!isRedisAvailable()) return;
        try {
            // First, batch-read all temp families using pipeline
            const readPipeline = redis.pipeline();
            for (const { tempId } of mappings) {
                readPipeline.hget('family', tempId.toString());
            }
            const readResults = await readPipeline.exec();
            
            // Parse results and prepare family write operations
            const writePipeline = redis.pipeline();
            const personUpdates = []; // Collect person updates to batch later
            
            for (let i = 0; i < mappings.length; i++) {
                const { tempId, newId } = mappings[i];
                const [err, json] = readResults[i];
                if (err || !json) continue;
                
                let family;
                try { family = JSON.parse(json); } catch { continue; }
                
                // Remove old entry, add with new ID
                writePipeline.hdel('family', tempId.toString());
                family.id = newId;
                delete family._isNew;
                writePipeline.hset('family', newId.toString(), JSON.stringify(family));
                
                // Collect person IDs that need family_id update
                if (family.husband_id) personUpdates.push({ personId: family.husband_id, newFamilyId: newId });
                if (family.wife_id) personUpdates.push({ personId: family.wife_id, newFamilyId: newId });
                for (const childId of (family.children_ids || [])) {
                    personUpdates.push({ personId: childId, newFamilyId: newId });
                }
            }
            
            await writePipeline.exec();
            
            // Now batch-update person family_ids
            if (personUpdates.length > 0) {
                // Read all affected people
                const personReadPipeline = redis.pipeline();
                for (const { personId } of personUpdates) {
                    personReadPipeline.hget('person', personId.toString());
                }
                const personReadResults = await personReadPipeline.exec();
                
                // Update and write back
                const personWritePipeline = redis.pipeline();
                for (let i = 0; i < personUpdates.length; i++) {
                    const { personId, newFamilyId } = personUpdates[i];
                    const [err, json] = personReadResults[i];
                    if (err || !json) continue;
                    
                    let person;
                    try { person = JSON.parse(json); } catch { continue; }
                    
                    person.family_id = newFamilyId;
                    personWritePipeline.hset('person', personId.toString(), JSON.stringify(person));
                }
                await personWritePipeline.exec();
            }
        } catch (err) {
            console.warn('[PopulationState] reassignFamilyIds failed:', err.message);
        }
    }

    /**
     * Full sync from Postgres: refill Redis person hash and village sets
     */
    static async syncFromPostgres() {
        if (!isRedisAvailable()) return { skipped: true, reason: 'Redis not available' };
        try {
            console.log('[PopulationState] Syncing population from Postgres to Redis...');
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
                console.log('[PopulationState] Cleared Redis population keys');
            } catch (e) {
                console.warn('[PopulationState] Failed to clear Redis population keys:', e.message);
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
            
            console.log(`[PopulationState] Synced ${total} people to Redis (${maleCount} male, ${femaleCount} female)`);
            return { success: true, total, male: maleCount, female: femaleCount };
        } catch (err) {
            console.error('[PopulationState] syncFromPostgres failed:', err.message);
            throw err;
        }
    }
}

module.exports = PopulationState;
