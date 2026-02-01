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
import { acquireLock, releaseLock } from '../../utils/lock';
import { logError, ErrorSeverity, safeExecute } from '../../utils/errorHandler';
import { StoredPerson, PipelineResult, getErrorMessage } from './types';

/**
 * Full sync from Postgres: refill Redis person hash and village sets
 */
export async function syncFromPostgres() {
    if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

    const lockKey = 'population:sync:lock';
    const token = await acquireLock(lockKey, 30000, 5000);
    if (!token) {
        console.warn('[PopulationSync] syncFromPostgres skipped: could not acquire sync lock');
        return { skipped: true, reason: 'could not acquire sync lock' };
    }

    try {
        console.log('[PopulationSync] Syncing population from Postgres to storage...');

        // Clear existing data
        try {
            console.log('[PopulationSync.syncFromPostgres] About to delete person hash!');
            console.trace('[PopulationSync.syncFromPostgres] Stack trace:');
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
                if (p.tile_id && p.residency !== null && p.residency !== undefined) {
                    pipeline.sadd(`village:${p.tile_id}:${p.residency}:people`, id);
                }
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

        console.log(`[PopulationSync] Synced ${total} people to storage (${maleCount} male, ${femaleCount} female)`);
        return { success: true, total, male: maleCount, female: femaleCount };
    } catch (err: unknown) {
        console.error('[PopulationSync] syncFromPostgres failed:', getErrorMessage(err));
        throw err;
    } finally {
        await safeExecute(
            () => releaseLock(lockKey, token),
            'PopulationSync:ReleaseLock:SyncFromPostgres',
            null,
            ErrorSeverity.LOW
        );
    }
}

/**
 * Rebuild village membership sets from the authoritative 'person' hash
 */
export async function rebuildVillageMemberships() {
    if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

    const lockKey = 'population:sync:lock';
    const token = await acquireLock(lockKey, 30000, 5000);
    if (!token) {
        // Lock contention is expected - silently skip
        return { skipped: true, reason: 'could not acquire sync lock' };
    }

    try {
        // Clear all village:*:*:people sets
        const stream = storage.scanStream({ match: 'village:*:*:people', count: 1000 });
        const keysToDelete: string[] = [];
        for await (const ks of stream) {
            for (const k of ks as string[]) keysToDelete.push(k);
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
            let person: StoredPerson | null = null;
            try { person = JSON.parse(json) as StoredPerson; } catch { continue; }
            if (person && person.tile_id && person.residency !== null && person.residency !== undefined) {
                pipeline.sadd(`village:${person.tile_id}:${person.residency}:people`, id);
                total++;
            }
        }
        await pipeline.exec();
        return { success: true, total };
    } catch (e: unknown) {
        console.warn('[PopulationSync] rebuildVillageMemberships failed:', getErrorMessage(e));
        return { success: false, error: getErrorMessage(e) };
    } finally {
        if (token) {
            await safeExecute(
                () => releaseLock(lockKey, token),
                'PopulationSync:ReleaseLock:RebuildVillageMemberships',
                null,
                ErrorSeverity.LOW
            );
        }
    }
}

/**
 * Quick integrity check and repair: if duplicate memberships detected, rebuild sets
 */
export async function repairIfNeeded() {
    if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };

    const lockKey = 'population:sync:lock';
    const token = await acquireLock(lockKey, 30000, 5000);
    if (!token) {
        // Lock contention is expected - silently skip
        return { skipped: true, reason: 'could not acquire sync lock' };
    }

    try {
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
            // Silently repair - this is expected occasionally with concurrent operations
            const res = await rebuildVillageMemberships();
            return { repaired: true, before: { totalScards, totalUnique }, result: res };
        }
        return { ok: true };
    } catch (e: unknown) {
        // Silently ignore repair failures - they'll be retried
        return { ok: false, error: getErrorMessage(e) };
    } finally {
        if (token) {
            await safeExecute(
                () => releaseLock(lockKey, token),
                'PopulationSync:ReleaseLock:RepairIfNeeded',
                null,
                ErrorSeverity.LOW
            );
        }
    }
}
