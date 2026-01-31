// Population Operations - Storage Reset Module
import serverConfig from '../../../config/server';
import storage from '../../storage';
import { Pool } from 'pg';
import {
    PopulationOptions,
    PopulationServiceInstance,
    FormattedPopulationData
} from './types';
import { formatPopData, loadPopData } from './helpers';

/**
 * Clears all population data from storage (Redis)
 */
export async function clearStoragePopulation(options: PopulationOptions = {}): Promise<void> {
    const flag = options ? options.preserveDatabase : false;
    const preserveDatabase = flag === true || flag === 'true';
    if (preserveDatabase) {
        console.log('[clearStoragePopulation] preserveDatabase=true, skipping storage clear');
        return;
    }
    try {
        if (!storage.isAvailable()) {
            // Storage may not yet be ready (e.g., Redis connecting). Wait briefly for a 'ready' event
            if (serverConfig.verboseLogs) console.log('[clearStoragePopulation] storage not available, waiting for ready event...');
            await Promise.race([
                new Promise<void>(resolve => storage.on('ready', resolve)),
                new Promise<void>(resolve => setTimeout(resolve, 5000))
            ]);
            if (!storage.isAvailable()) {
                console.warn('[clearStoragePopulation] storage remained unavailable after waiting; skipping clear');
                return;
            }
        }

        // Clear person hash
        await storage.del('person');
        // Clear village hash (village objects)
        await storage.del('village');
        // Clear family hash
        await storage.del('family');
        // Clear all pending operations (prevent stale pending entries from previous sessions)
        await storage.del('pending:person:inserts');
        await storage.del('pending:person:updates');
        await storage.del('pending:person:deletes');
        await storage.del('pending:family:inserts');
        await storage.del('pending:family:updates');
        await storage.del('pending:family:deletes');
        await storage.del('pending:village:inserts');
        // Clear all village:*:*:people sets
        const stream = storage.scanStream({ match: 'village:*:*:people', count: 1000 });
        const keys: string[] = [];
        for await (const resultKeys of stream) {
            for (const key of resultKeys) keys.push(key);
        }
        if (keys.length > 0) await storage.del(...keys);
        // Reset counts
        await storage.del('counts:global');
        if (serverConfig.verboseLogs) console.log('[clearStoragePopulation] Cleared storage population data');
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.warn('[clearStoragePopulation] Failed to clear storage:', errorMessage);
    }
}

/**
 * Resets all population data
 * @param pool - Database pool instance
 * @param serviceInstance - Population service instance
 * @param options - Options for reset operation
 * @returns Formatted empty population data
 */
export async function resetAllPopulation(
    pool: Pool,
    serviceInstance: PopulationServiceInstance,
    options: PopulationOptions = {}
): Promise<FormattedPopulationData> {
    const flag = options ? options.preserveDatabase : false;
    const preserveDatabase = flag === true || flag === 'true';
    if (preserveDatabase) {
        const existingPopulations = await loadPopData(pool);
        await serviceInstance.broadcastUpdate('populationReset');
        return formatPopData(existingPopulations);
    }
    if (serverConfig.verboseLogs) {
        console.log('[resetAllPopulation] preserveDatabase=false');
    }
    try {
        if (serverConfig.verboseLogs) console.log('[resetAllPopulation] Clearing Redis storage (Postgres preserved until explicit save)...');
        // Clear storage population data (Redis only) - Postgres is preserved until save
        await clearStoragePopulation();
        if (serverConfig.verboseLogs) console.log('[resetAllPopulation] Redis cleared. Broadcasting update...');
        await serviceInstance.broadcastUpdate('populationReset');
        return formatPopData({});
    } catch (error: unknown) {
        console.error('[resetAllPopulation] Error details:', error);
        throw error;
    }
}
