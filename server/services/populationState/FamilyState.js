/**
 * FamilyState - Redis state management for families
 * 
 * Handles:
 * - Family CRUD operations
 * - Fertile family tracking
 * - Pending insert/update/delete tracking
 * - ID reassignment after Postgres sync
 */

const { isRedisAvailable, getRedis } = require('./redisHelpers');

class FamilyState {
    static nextFamilyTempId = -1;

    /**
     * Get a new temporary ID for a family created in Redis-only mode
     */
    static async getNextTempId() {
        const redis = getRedis();
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
        const redis = getRedis();
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
            console.warn('[FamilyState] addFamily failed:', err.message);
            return false;
        }
    }

    /**
     * Get a family from Redis
     */
    static async getFamily(familyId) {
        const redis = getRedis();
        if (!isRedisAvailable()) return null;
        const json = await redis.hget('family', familyId.toString());
        return json ? JSON.parse(json) : null;
    }

    /**
     * Update a family in Redis
     */
    static async updateFamily(familyId, updates) {
        const redis = getRedis();
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
            console.warn('[FamilyState] updateFamily failed:', err.message);
            return false;
        }
    }

    /**
     * Remove a family from Redis
     * @param {number} familyId
     * @param {boolean} markDeleted - If true, track for Postgres deletion
     */
    static async removeFamily(familyId, markDeleted = false) {
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
        try {
            const family = await this.getFamily(familyId);
            if (!family) return false;

            // Remove from fertile set if present
            await this.removeFertileFamily(familyId);

            await redis.hdel('family', familyId.toString());

            if (markDeleted && familyId > 0) {
                await redis.sadd('pending:family:deletes', familyId.toString());
            }
            if (familyId < 0) {
                await redis.srem('pending:family:inserts', familyId.toString());
            }

            return true;
        } catch (err) {
            console.warn('[FamilyState] removeFamily failed:', err.message);
            return false;
        }
    }

    /**
     * Get all families from Redis
     */
    static async getAllFamilies() {
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        const data = await redis.hgetall('family');
        return Object.values(data).map(json => JSON.parse(json));
    }

    // =========== FERTILE FAMILIES ===========

    /**
     * Add a family to the fertile set (can have babies)
     * @param {number} familyId
     * @param {number} tileId
     */
    static async addFertileFamily(familyId, tileId) {
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
        try {
            await redis.sadd(`fertile:${tileId}`, familyId.toString());
            return true;
        } catch (err) {
            console.warn('[FamilyState] addFertileFamily failed:', err.message);
            return false;
        }
    }

    /**
     * Remove a family from all fertile sets
     */
    static async removeFertileFamily(familyId) {
        const redis = getRedis();
        if (!isRedisAvailable()) return false;
        try {
            // Scan for fertile:* keys and remove from all
            const stream = redis.scanStream({ match: 'fertile:*', count: 100 });
            for await (const keys of stream) {
                for (const key of keys) {
                    await redis.srem(key, familyId.toString());
                }
            }
            return true;
        } catch (err) {
            console.warn('[FamilyState] removeFertileFamily failed:', err.message);
            return false;
        }
    }

    /**
     * Get all fertile families for a tile
     */
    static async getFertileFamilies(tileId) {
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        return redis.smembers(`fertile:${tileId}`);
    }

    // =========== PENDING OPERATIONS ===========

    /**
     * Get pending family inserts
     */
    static async getPendingInserts() {
        const redis = getRedis();
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
            console.warn('[FamilyState] getPendingInserts failed:', err.message);
            return [];
        }
    }

    /**
     * Get pending family updates (families that were modified)
     */
    static async getPendingUpdates() {
        const redis = getRedis();
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
            console.warn('[FamilyState] getPendingUpdates failed:', err.message);
            return [];
        }
    }

    /**
     * Get pending family deletes
     */
    static async getPendingDeletes() {
        const redis = getRedis();
        if (!isRedisAvailable()) return [];
        try {
            const ids = await redis.smembers('pending:family:deletes');
            return ids.map(id => parseInt(id));
        } catch (err) {
            console.warn('[FamilyState] getPendingDeletes failed:', err.message);
            return [];
        }
    }

    /**
     * Clear pending family operations
     */
    static async clearPendingOperations() {
        const redis = getRedis();
        if (!isRedisAvailable()) return;
        try {
            await redis.del('pending:family:inserts');
            await redis.del('pending:family:updates');
            await redis.del('pending:family:deletes');
        } catch (err) {
            console.warn('[FamilyState] clearPendingOperations failed:', err.message);
        }
    }

    /**
     * Reassign temporary family IDs to Postgres IDs after batch insert
     * @param {Array} mappings - Array of { tempId, newId }
     */
    static async reassignIds(mappings) {
        const redis = getRedis();
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

            // Clear the pending inserts we just processed
            const delPipeline = redis.pipeline();
            for (const { tempId } of mappings) {
                delPipeline.srem('pending:family:inserts', tempId.toString());
            }
            await delPipeline.exec();
        } catch (err) {
            console.warn('[FamilyState] reassignIds failed:', err.message);
        }
    }

    // =========== SYNC ===========

    /**
     * Full sync from Postgres: refill Redis family hash
     */
    static async syncFromPostgres() {
        const redis = getRedis();
        const { getPool } = require('./redisHelpers');
        const pool = getPool();
        if (!isRedisAvailable()) return { skipped: true, reason: 'Redis not available' };
        try {
            console.log('[FamilyState] Syncing families from Postgres to Redis...');
            // Clear family hash
            await redis.del('family');

            // Load families in batches
            const batchSize = 5000;
            let offset = 0;
            let total = 0;

            while (true) {
                const res = await pool.query('SELECT id, husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids FROM families ORDER BY id LIMIT $1 OFFSET $2', [batchSize, offset]);
                if (!res.rows || res.rows.length === 0) break;
                const pipeline = redis.pipeline();
                for (const f of res.rows) {
                    const id = f.id.toString();
                    const familyObj = {
                        id: f.id,
                        husband_id: f.husband_id,
                        wife_id: f.wife_id,
                        tile_id: f.tile_id,
                        pregnancy: f.pregnancy || false,
                        delivery_date: f.delivery_date || null,
                        children_ids: f.children_ids || []
                    };
                    pipeline.hset('family', id, JSON.stringify(familyObj));
                }
                await pipeline.exec();
                total += res.rows.length;
                offset += res.rows.length;
            }

            console.log(`[FamilyState] Synced ${total} families to Redis`);
            return { success: true, total };
        } catch (err) {
            console.error('[FamilyState] syncFromPostgres failed:', err.message);
            throw err;
        }
    }
}

module.exports = FamilyState;
