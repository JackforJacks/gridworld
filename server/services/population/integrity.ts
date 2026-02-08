import storage from '../storage';
import { Pool } from 'pg';

/** Options for the integrity check/repair function */
interface IntegrityOptions {
    repair?: boolean;
}

/** Result of the integrity check */
interface IntegrityResult {
    ok: boolean;
    details: string | unknown[];
}

/**
 * Run integrity check (and optional repair) across provided tiles.
 * Currently a no-op stub - legacy membership checks have been removed.
 */
async function verifyAndRepairIntegrity(
    pool: Pool,
    tiles: number[] | null = null,
    _targets: Record<string, unknown> = {},
    options: IntegrityOptions = {}
): Promise<IntegrityResult> {
    if (!storage.isAvailable()) return { ok: true, details: 'Storage unavailable' };

    return { ok: true, details: [] };
}

export { verifyAndRepairIntegrity };
