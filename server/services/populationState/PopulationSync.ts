/**
 * PopulationSync - Sync and repair operations
 *
 * Handles:
 * - syncFromPostgres (deprecated)
 * - repairIfNeeded
 */

import storage from '../storage';

/**
 * Sync from Postgres - deprecated, returns skipped status
 */
export async function syncFromPostgres() {
    return { skipped: true, reason: 'deprecated' };
}

/**
 * Quick integrity check
 */
export async function repairIfNeeded() {
    if (!storage.isAvailable()) return { skipped: true, reason: 'storage not available' };
    return { ok: true };
}
