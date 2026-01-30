import storage from '../storage';
import PopulationState from '../populationState';
import { loadPopulationData } from './dataOperations';
import serverConfig from '../../config/server';
import { Pool } from 'pg';

/** Interface for a duplicate membership problem */
interface DuplicateProblem {
    id: string;
    sets: string[];
}

/** Interface for a mismatched person (tile mismatch) */
interface MismatchedPerson {
    id: string;
    personTile: number | string;
}

/** Interface for integrity check problems */
interface IntegrityProblem {
    tileId: number;
    duplicatesCount?: number;
    missingCount?: number;
    mismatchedCount?: number;
    error?: string;
}

/** Options for the integrity check/repair function */
interface IntegrityOptions {
    repair?: boolean;
}

/** Result of the integrity check */
interface IntegrityResult {
    ok: boolean;
    details: string | IntegrityProblem[];
}

/**
 * Run integrity check (and optional repair) across provided tiles.
 * If tiles is null, scans all tiles that currently have population (via DB fallback loadPopulationData).
 * options.repair: boolean - whether to perform repairs where issues are detected.
 */
async function verifyAndRepairIntegrity(
    pool: Pool,
    tiles: number[] | null = null,
    _targets: Record<string, unknown> = {},
    options: IntegrityOptions = {}
): Promise<IntegrityResult> {
    const repair = options.repair === true;

    if (!storage.isAvailable()) return { ok: true, details: 'Storage unavailable' };

    // Resolve tiles if not provided
    let tileList: number[] = [];
    if (!tiles || tiles.length === 0) {
        try {
            const populations = await loadPopulationData(pool);
            tileList = Object.keys(populations).map(k => parseInt(k, 10)).filter(x => !Number.isNaN(x));
        } catch (_err: unknown) {
            // Fallback to no tiles
            tileList = [];
        }
    } else {
        tileList = Array.from(tiles);
    }

    const problems: IntegrityProblem[] = [];

    for (const tileId of tileList) {
        try {
            const keys: string[] = await storage.keys(`village:${tileId}:*:people`);
            const personMap = new Map<string, Set<string>>();

            if (keys.length > 0) {
                const pipeline = storage.pipeline();
                for (const k of keys) pipeline.smembers(k);
                const results = await pipeline.exec();

                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    const members: string[] = results[i] && results[i][1] ? results[i][1] as string[] : [];
                    for (const id of members) {
                        if (!personMap.has(id)) personMap.set(id, new Set<string>());
                        personMap.get(id)!.add(k);
                    }
                }
            }

            const duplicates: DuplicateProblem[] = [];
            for (const [id, set] of personMap.entries()) {
                if (set.size > 1) {
                    duplicates.push({ id, sets: Array.from(set) });
                }
            }

            const missing: string[] = [];
            const mismatched: MismatchedPerson[] = [];

            for (const id of personMap.keys()) {
                const p = await PopulationState.getPerson(id);
                if (!p) missing.push(id);
                else if (p.tile_id && parseInt(String(p.tile_id), 10) !== parseInt(String(tileId), 10)) {
                    mismatched.push({ id, personTile: p.tile_id });
                }
            }

            const foundProblems = (duplicates.length || missing.length || mismatched.length);
            if (foundProblems) {
                if (!repair) {
                    problems.push({ tileId, duplicatesCount: duplicates.length, missingCount: missing.length, mismatchedCount: mismatched.length });
                }

                if (repair) {
                    // Repair duplicates
                    for (const d of duplicates) {
                        const id = d.id;
                        const p = await PopulationState.getPerson(id);
                        let keepKey: string | null = null;
                        if (p && p.residency !== null && p.residency !== undefined) {
                            const candidate = `village:${tileId}:${p.residency}:people`;
                            if (d.sets.includes(candidate)) keepKey = candidate;
                        }
                        if (!keepKey) keepKey = d.sets[0];
                        const removeKeys = d.sets.filter((k: string) => k !== keepKey);
                        if (removeKeys.length > 0) {
                            const remPipe = storage.pipeline();
                            for (const rk of removeKeys) remPipe.srem(rk, id);
                            await remPipe.exec();
                            if (serverConfig.verboseLogs) console.log(`[IntegrityRepair] Removed duplicate membership id=${id} from keys=${removeKeys.join(',')}`);
                        }
                    }

                    // Remove missing person memberships
                    if (missing.length > 0) {
                        const remPipe = storage.pipeline();
                        for (const id of missing) {
                            for (const k of personMap.get(id) || []) remPipe.srem(k, id);
                        }
                        await remPipe.exec();
                        if (serverConfig.verboseLogs) console.log(`[IntegrityRepair] Removed ${missing.length} memberships referencing missing persons on tile ${tileId}`);
                    }

                    // Remove mismatched memberships
                    if (mismatched.length > 0) {
                        const remPipe = storage.pipeline();
                        for (const m of mismatched) {
                            const sets = personMap.get(m.id) || [];
                            for (const k of sets) remPipe.srem(k, m.id);
                        }
                        await remPipe.exec();
                        if (serverConfig.verboseLogs) console.log(`[IntegrityRepair] Removed ${mismatched.length} memberships where person.tile_id != ${tileId}`);
                    }
                }
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            problems.push({ tileId, error: errorMessage });
        }
    }

    const ok = problems.length === 0;

    // Update lightweight metrics (if available)
    try {
        const metrics = require('../metrics');
        if (metrics && metrics.lastRunGauge) metrics.lastRunGauge.set(Date.now() / 1000);
        if (metrics && metrics.issuesGauge) {
            const issuesCount = problems.reduce((sum: number, p: IntegrityProblem) => sum + (p.duplicatesCount || p.missingCount || p.mismatchedCount || 0), 0);
            metrics.issuesGauge.set(issuesCount);
        }
    } catch (_ignored: unknown) { /* ignore */ }

    return { ok, details: problems };
}

export { verifyAndRepairIntegrity };
