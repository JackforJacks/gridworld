/**
 * FamilyState - Redis state management for families
 * 
 * Handles:
 * - Family CRUD operations
 * - Fertile family tracking
 * - Pending insert/update/delete tracking
 * - ID reassignment after Postgres sync
 */

import storage from '../storage';
import idAllocator from '../idAllocator';
import type { FamilyData } from '../../../types/global';

/**
 * Internal family data stored in Redis (extends FamilyData with tracking flag)
 */
interface StoredFamilyData extends FamilyData {
    _isNew?: boolean;
}

/**
 * Redis pipeline execution result tuple
 */
type PipelineResult = [Error | null, string | null];

/**
 * ID reassignment mapping
 */
interface IdMapping {
    tempId: number;
    newId: number;
}

/**
 * Person update tracking for family ID reassignment
 */
interface PersonFamilyUpdate {
    personId: number;
    newFamilyId: number;
}

class FamilyState {
    /**
     * Get the next real Postgres ID for a new family
     * IDs are pre-allocated from Postgres sequences, so they're valid for direct insert later
     */
    static async getNextId(): Promise<number> {
        return idAllocator.getNextFamilyId();
    }

    /**
     * Get a batch of real Postgres IDs for multiple new families
     * @param count - Number of IDs needed
     */
    static async getIdBatch(count: number): Promise<number[]> {
        return idAllocator.getFamilyIdBatch(count);
    }

    /**
     * Add a family to Redis
     * @param family - Family data object
     * @param isNew - If true, track as pending insert
     */
    static async addFamily(family: FamilyData, isNew: boolean = false): Promise<boolean> {
        if (!storage.isAvailable()) return false;
        try {
            const id = family.id.toString();
            const f: StoredFamilyData = {
                id: family.id,
                husband_id: family.husband_id,
                wife_id: family.wife_id,
                tile_id: family.tile_id,
                pregnancy: family.pregnancy || false,
                delivery_date: family.delivery_date || null,
                children_ids: family.children_ids || [],
                _isNew: isNew
            };
            await storage.hset('family', id, JSON.stringify(f));
            if (isNew) {
                await storage.sadd('pending:family:inserts', id);
            }
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] addFamily failed:', message);
            return false;
        }
    }

    /**
     * Get a family from Redis
     */
    static async getFamily(familyId: number): Promise<StoredFamilyData | null> {
        if (!storage.isAvailable()) return null;
        const json = await storage.hget('family', familyId.toString());
        return json ? JSON.parse(json) as StoredFamilyData : null;
    }

    /**
     * Update a family in Redis
     */
    static async updateFamily(familyId: number, updates: Partial<FamilyData>): Promise<boolean> {
        if (!storage.isAvailable()) return false;
        try {
            const family = await this.getFamily(familyId);
            if (!family) return false;
            const updated: StoredFamilyData = { ...family, ...updates };
            await storage.hset('family', familyId.toString(), JSON.stringify(updated));
            // Track modified families for batch update (only for existing Postgres records)
            if (familyId > 0 && !family._isNew) {
                await storage.sadd('pending:family:updates', familyId.toString());
            }
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] updateFamily failed:', message);
            return false;
        }
    }

    /**
     * Remove a family from Redis
     * @param familyId - The family ID to remove
     * @param markDeleted - If true, track for Postgres deletion
     */
    static async removeFamily(familyId: number, markDeleted: boolean = false): Promise<boolean> {
        if (!storage.isAvailable()) return false;
        try {
            const family = await this.getFamily(familyId);
            if (!family) return false;

            // Remove from fertile set if present
            await this.removeFertileFamily(familyId);

            await storage.hdel('family', familyId.toString());

            if (markDeleted && familyId > 0) {
                await storage.sadd('pending:family:deletes', familyId.toString());
            }
            if (familyId < 0) {
                await storage.srem('pending:family:inserts', familyId.toString());
            }

            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] removeFamily failed:', message);
            return false;
        }
    }

    /**
     * Get all families from Redis
     */
    static async getAllFamilies(): Promise<StoredFamilyData[]> {
        if (!storage.isAvailable()) return [];
        const data = await storage.hgetall('family') as Record<string, string>;
        return Object.values(data).map((json) => JSON.parse(json) as StoredFamilyData);
    }

    // =========== FERTILE FAMILIES ===========

    /**
     * Add a family to the fertile set (can have babies)
     * @param familyId - The family ID
     * @param tileId - The tile ID
     */
    static async addFertileFamily(familyId: number, tileId: number): Promise<boolean> {
        if (!storage.isAvailable()) return false;
        try {
            // Keep legacy per-tile fertile set for compatibility
            await storage.sadd(`fertile:${tileId}`, familyId.toString());
            // Also enqueue into the global fertile queue so consumers can pop due families without scanning
            try {
                const score = Date.now(); // immediate
                if (typeof storage.atomicEnqueueFertile === 'function') {
                    await storage.atomicEnqueueFertile(familyId, score);
                } else {
                    // Fallback: add to global members + zset
                    await storage.sadd('fertile:members', String(familyId));
                    if (typeof storage.zadd === 'function') await storage.zadd('fertile:queue', score, String(familyId));
                }
            } catch (_e: unknown) { /* non-fatal */ }
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] addFertileFamily failed:', message);
            return false;
        }
    }

    /**
     * Remove a family from all fertile sets
     */
    static async removeFertileFamily(familyId: number): Promise<boolean> {
        if (!storage.isAvailable()) return false;
        try {
            // Scan for fertile:* keys and remove from all
            const stream = storage.scanStream({ match: 'fertile:*', count: 100 });
            for await (const keys of stream) {
                for (const key of keys as string[]) {
                    await storage.srem(key, familyId.toString());
                }
            }
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] removeFertileFamily failed:', message);
            return false;
        }
    }

    /**
     * Get all fertile families for a tile
     */
    static async getFertileFamilies(tileId: number): Promise<string[]> {
        if (!storage.isAvailable()) return [];
        return storage.smembers(`fertile:${tileId}`);
    }

    // =========== PENDING OPERATIONS ===========

    /**
     * Get pending family inserts
     */
    static async getPendingInserts(): Promise<StoredFamilyData[]> {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers('pending:family:inserts');
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = storage.pipeline();
            for (const id of ids) {
                pipeline.hget('family', id.toString());
            }
            const results = await pipeline.exec() as PipelineResult[];

            const families: StoredFamilyData[] = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    try {
                        families.push(JSON.parse(json) as StoredFamilyData);
                    } catch (_e: unknown) { /* skip invalid JSON */ }
                }
            }
            return families;
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] getPendingInserts failed:', message);
            return [];
        }
    }

    /**
     * Get pending family updates (families that were modified)
     */
    static async getPendingUpdates(): Promise<StoredFamilyData[]> {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers('pending:family:updates');
            if (ids.length === 0) return [];

            // Use pipeline for batch reads
            const pipeline = storage.pipeline();
            for (const id of ids) {
                pipeline.hget('family', id.toString());
            }
            const results = await pipeline.exec() as PipelineResult[];

            const families: StoredFamilyData[] = [];
            for (const [err, json] of results) {
                if (!err && json) {
                    try {
                        families.push(JSON.parse(json) as StoredFamilyData);
                    } catch (_e: unknown) { /* skip invalid JSON */ }
                }
            }
            return families;
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] getPendingUpdates failed:', message);
            return [];
        }
    }

    /**
     * Get pending family deletes
     */
    static async getPendingDeletes(): Promise<number[]> {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers('pending:family:deletes');
            return ids.map((id: string) => parseInt(id, 10));
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] getPendingDeletes failed:', message);
            return [];
        }
    }

    /**
     * Clear pending family operations
     */
    static async clearPendingOperations(): Promise<void> {
        if (!storage.isAvailable()) return;
        try {
            await storage.del('pending:family:inserts');
            await storage.del('pending:family:updates');
            await storage.del('pending:family:deletes');
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] clearPendingOperations failed:', message);
        }
    }

    /**
     * Reassign temporary family IDs to Postgres IDs after batch insert
     * @param mappings - Array of { tempId, newId }
     */
    static async reassignIds(mappings: IdMapping[]): Promise<void> {
        if (!storage.isAvailable()) return;
        try {
            // First, batch-read all temp families using pipeline
            const readPipeline = storage.pipeline();
            for (const { tempId } of mappings) {
                readPipeline.hget('family', tempId.toString());
            }
            const readResults = await readPipeline.exec() as PipelineResult[];

            // Parse results and prepare family write operations
            const writePipeline = storage.pipeline();
            const personUpdates: PersonFamilyUpdate[] = []; // Collect person updates to batch later

            for (let i = 0; i < mappings.length; i++) {
                const { tempId, newId } = mappings[i];
                const [err, json] = readResults[i];
                if (err || !json) continue;

                let family: StoredFamilyData;
                try { family = JSON.parse(json) as StoredFamilyData; } catch { continue; }

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
                const personReadPipeline = storage.pipeline();
                for (const { personId } of personUpdates) {
                    personReadPipeline.hget('person', personId.toString());
                }
                const personReadResults = await personReadPipeline.exec() as PipelineResult[];

                // Update and write back
                const personWritePipeline = storage.pipeline();
                for (let i = 0; i < personUpdates.length; i++) {
                    const { personId, newFamilyId } = personUpdates[i];
                    const [err, json] = personReadResults[i];
                    if (err || !json) continue;

                    let person: Record<string, unknown>;
                    try { person = JSON.parse(json) as Record<string, unknown>; } catch { continue; }

                    person.family_id = newFamilyId;
                    personWritePipeline.hset('person', personId.toString(), JSON.stringify(person));
                }
                await personWritePipeline.exec();
            }

            // Clear the pending inserts we just processed
            const delPipeline = storage.pipeline();
            for (const { tempId } of mappings) {
                delPipeline.srem('pending:family:inserts', tempId.toString());
            }
            await delPipeline.exec();
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.warn('[FamilyState] reassignIds failed:', message);
        }
    }

    // =========== SYNC ===========

    /**
     * Full sync from Postgres: refill Redis family hash
     */
    static async syncFromPostgres(): Promise<{ skipped?: boolean; reason?: string; success?: boolean; total?: number }> {
        const pool = require('../../config/database').default;
        if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };
        try {
            console.log('[FamilyState] Syncing families from Postgres to storage...');
            // Clear family hash
            await storage.del('family');

            // Load families in batches
            const batchSize = 5000;
            let offset = 0;
            let total = 0;

            while (true) {
                const res = await pool.query('SELECT id, husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids FROM family ORDER BY id LIMIT $1 OFFSET $2', [batchSize, offset]);
                if (!res.rows || res.rows.length === 0) break;
                const pipeline = storage.pipeline();
                for (const f of res.rows) {
                    const id = f.id.toString();
                    const familyObj: FamilyData = {
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

            console.log(`[FamilyState] Synced ${total} families to storage`);
            return { success: true, total };
        } catch (err: unknown) {
            const message = err instanceof Error ? (err as Error).message : String(err);
            console.error('[FamilyState] syncFromPostgres failed:', message);
            throw err;
        }
    }
}

export default FamilyState;
