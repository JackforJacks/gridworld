// Population Operations - Storage Reset Module
import serverConfig from '../../../config/server';
// Storage removed - all data in Rust ECS
import {
    PopulationOptions,
    PopulationServiceInstance,
    FormattedPopulationData
} from './types';
import { formatPopData, loadPopData } from './helpers';

/**
 * Clears all population data from storage (Redis)
 * Storage removed - all data in Rust ECS
 */
export async function clearStoragePopulation(options: PopulationOptions = {}): Promise<void> {
    const flag = options ? options.preserveDatabase : false;
    const preserveDatabase = flag === true || flag === 'true';
    if (preserveDatabase) {
        console.log('[clearStoragePopulation] preserveDatabase=true, skipping storage clear');
        return;
    }
    // Storage removed - all data in Rust ECS
    if (serverConfig.verboseLogs) console.log('[clearStoragePopulation] Storage removed - all data managed by Rust ECS');
}

/**
 * Resets all population data
 * @param pool - Database pool instance
 * @param serviceInstance - Population service instance
 * @param options - Options for reset operation
 * @returns Formatted empty population data
 */
export async function resetAllPopulation(
    _pool?: unknown,
    serviceInstance?: PopulationServiceInstance,
    options: PopulationOptions = {}
): Promise<FormattedPopulationData> {
    const flag = options ? options.preserveDatabase : false;
    const preserveDatabase = flag === true || flag === 'true';
    if (preserveDatabase) {
        const existingPopulations = await loadPopData();
        await serviceInstance?.broadcastUpdate('populationReset');
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
        await serviceInstance?.broadcastUpdate('populationReset');
        return formatPopData({});
    } catch (error: unknown) {
        console.error('[resetAllPopulation] Error details:', error);
        throw error;
    }
}
