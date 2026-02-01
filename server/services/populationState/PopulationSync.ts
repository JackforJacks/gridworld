/**
 * PopulationSync - Sync between Redis and Postgres
 * 
 * Handles:
 * - syncFromPostgres
 * - rebuildVillageMemberships
 * - repairIfNeeded
 */

import storage from '../storage';
import pool from '../../config/database';
import { withSyncLock } from '../population/lockUtils';
import { StoredPerson, PipelineResult, getErrorMessage } from './types';

/** Check if sex value represents male (handles various data formats from Postgres/Redis) */
function checkIsMale(sex: boolean | string | number | null | undefined): boolean {
    return sex === true || sex === 'true' || sex === 1 || sex === 't' || sex === 'M';
}

/**
 * Full sync from Postgres: refill Redis person hash and village sets
 */
export async function syncFromPostgres() {
    if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

    return withSyncLock(async () => {
        console.log('[PopulationSync] Syncing population from Postgres to storage...');

        // Clear existing data
        try {
            await storage.del('person');

            const stream = storage.scanStream({ match: 'village:*:*:people', count: 1000 });
            const keys: string[] = [];
            for await (const resultKeys of stream) {
                for (const key of resultKeys as string[]) keys.push(key);
            }
            if (keys.length > 0) await storage.del(...keys);
            await storage.del('counts:global');
            console.log('[PopulationSync] Cleared storage population keys');
        } catch (e: unknown) {
            console.warn('[PopulationSync] Failed to clear Redis population keys:', getErrorMessage(e));
        }

        // Load people in batches
        const batchSize = 10000;
        let offset = 0;
        let total = 0;
        let maleCount = 0, femaleCount = 0;

        while (true) {
            const res = await pool.query(
                'SELECT id, tile_id, residency, sex, date_of_birth, family_id FROM people ORDER BY id LIMIT $1 OFFSET $2',
                [batchSize, offset]
            );
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
                // Only add to village sets if residency is a valid village ID (> 0)
                if (p.tile_id && p.residency !== null && p.residency !== undefined && p.residency !== 0) {
                    pipeline.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
                }
                if (checkIsMale(p.sex)) maleCount++;
                else femaleCount++;
            }
            await pipeline.exec();
            total += res.rows.length;
            offset += res.rows.length;
        }

        // Set demographic counters
        await storage.hset('counts:global', 'total', total.toString());
        await storage.hset('counts:global', 'male', maleCount.toString());
        await storage.hset('counts:global', 'female', femaleCount.toString());

        console.log(`[PopulationSync] Synced ${total} people to storage (${maleCount} male, ${femaleCount} female)`);
        return { success: true, total, male: maleCount, female: femaleCount };
    });
}

/**
 * Internal: Rebuild village membership sets (assumes lock is already held)
 * Uses HSCAN for memory efficiency with large populations
 */
async function rebuildVillageMembershipsInternal(): Promise<{ success: true; total: number; withResidency: number } | { success: false; error: string }> {
    try {
        // Clear all village:*:*:people sets
        const stream = storage.scanStream({ match: 'village:*:*:people', count: 1000 });
        const keysToDelete: string[] = [];
        for await (const ks of stream) {
            for (const k of ks as string[]) keysToDelete.push(k);
        }
        if (keysToDelete.length > 0) {
            // Delete in batches to avoid command too long
            const BATCH_SIZE = 1000;
            for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
                const batch = keysToDelete.slice(i, i + BATCH_SIZE);
                await storage.del(...batch);
            }
        }

        // Use HSCAN to iterate over persons without loading all into memory
        let total = 0;
        let withResidency = 0;
        let pipeline = storage.pipeline();
        let pipelineCount = 0;
        const PIPELINE_BATCH = 1000;

        const personStream = storage.hscanStream('person', { count: 500 });

        for await (const result of personStream) {
            // HSCAN returns [field, value, field, value, ...]
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const id = entries[i];
                const json = entries[i + 1];
                if (!json) continue;

                total++;
                let person: StoredPerson | null = null;
                try { person = JSON.parse(json) as StoredPerson; } catch { continue; }

                // Only add to village sets if residency is a valid village ID (> 0)
                if (person && person.tile_id && person.residency !== null && person.residency !== undefined && person.residency !== 0) {
                    pipeline.sadd(`village:${person.tile_id}:${person.residency}:people`, id);
                    withResidency++;
                    pipelineCount++;

                    // Execute pipeline in batches
                    if (pipelineCount >= PIPELINE_BATCH) {
                        await pipeline.exec();
                        pipeline = storage.pipeline();
                        pipelineCount = 0;
                    }
                }
            }
        }

        // Execute remaining pipeline commands
        if (pipelineCount > 0) {
            await pipeline.exec();
        }

        return { success: true, total, withResidency };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Rebuild village membership sets from the authoritative 'person' hash
 */
export async function rebuildVillageMemberships() {
    if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

    return withSyncLock(async () => {
        return rebuildVillageMembershipsInternal();
    });
}

/**
 * Quick integrity check and repair: if duplicate memberships detected, rebuild sets
 */
export async function repairIfNeeded() {
    if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

    return withSyncLock(async () => {
        let totalScards = 0;
        const stream = storage.scanStream({ match: 'village:*:*:people', count: 100 });
        const keys: string[] = [];
        for await (const ks of stream) {
            for (const k of ks as string[]) keys.push(k);
        }
        if (keys.length === 0) return { ok: true, reason: 'no village sets' };

        const pipeline = storage.pipeline();
        for (const key of keys) pipeline.scard(key);
        const results = await pipeline.exec() as PipelineResult;
        for (const [err, sc] of results) {
            if (!err && typeof sc === 'number') totalScards += sc;
        }

        // Build unique count
        const personSet = new Set<string>();
        for (const key of keys) {
            const members = await storage.smembers(key);
            for (const m of members) personSet.add(String(m));
        }
        const totalUnique = personSet.size;

        if (totalScards > totalUnique) {
            // Repair using the internal function (we already hold the lock)
            const res = await rebuildVillageMembershipsInternal();
            return { repaired: true, before: { totalScards, totalUnique }, result: res };
        }
        return { ok: true };
    });
}
