// Population Operations - Population Updater Module
// Phase 6: Tile population updates are now handled by Rust ECS
// This module contains deprecated functions maintained for backward compatibility
import { addPeopleToTile } from '../manager';
import {
    CalendarService,
    PopulationServiceInstance,
    TilePopulations,
    FormattedPopulationData
} from './types';
import { formatPopData, loadPopData } from './helpers';
import { clearStoragePopulation } from './storageReset';

/**
 * Updates population for a specific tile
 * @param pool - Database pool instance
 * @param calendarService - Calendar service instance
 * @param serviceInstance - Population service instance
 * @param tileId - The tile ID
 * @param population - New population count
 */
export async function updateTilePopulation(
    _pool: unknown,
    calendarService: CalendarService | null,
    serviceInstance: PopulationServiceInstance,
    tileId: string | number,
    population: number
): Promise<void> {
    // Procreation removed - Rust simulation handles population updates
    console.warn('⚠️ updateTilePopulation is deprecated - Rust simulation handles population updates');
    // This function is now a no-op
}

/**
 * Updates populations for multiple tiles
 * @param pool - Database pool instance
 * @param calendarService - Calendar service instance
 * @param serviceInstance - Population service instance
 * @param tilePopulations - Object with tileId -> population mappings
 * @returns Formatted population data
 */
export async function updateMultipleTilePopulations(
    _pool: unknown,
    calendarService?: CalendarService | null,
    serviceInstance?: PopulationServiceInstance,
    tilePopulations?: TilePopulations
): Promise<FormattedPopulationData> {
    if (!tilePopulations || typeof tilePopulations !== 'object') {
        throw new Error('tilePopulations must be an object');
    }
    if (!serviceInstance) {
        throw new Error('serviceInstance is required');
    }

    let totalUpdated = 0;
    for (const [tileId, population] of Object.entries(tilePopulations)) {
        if (typeof population === 'number' && population >= 0) {
            await updateTilePopulation(undefined, calendarService ?? null, serviceInstance, tileId, population);
            totalUpdated++;
        }
    }

    const populations = await loadPopData();
    return formatPopData(populations);
}

/**
 * Regenerates population with new age distribution
 * @param _pool - Unused, kept for API compatibility
 * @param calendarService - Calendar service instance
 * @param serviceInstance - Population service instance
 * @returns Formatted population data
 */
export async function regeneratePopulationWithNewAgeDistribution(
    _pool: unknown,
    calendarService?: CalendarService | null,
    serviceInstance?: PopulationServiceInstance
): Promise<FormattedPopulationData> {
    try {
        console.log('🔄 Regenerating population with new age distribution...');

        const existingPopulations = await loadPopData();
        const tileIds = Object.keys(existingPopulations);

        if (tileIds.length === 0) {
            console.log('No existing population found to regenerate');
            return formatPopData({});
        }

        const currentPopulations = { ...existingPopulations };
        // Clear storage population data first
        await clearStoragePopulation();
        // pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE') removed - no longer using Postgres directly

        // Get current date from calendar service
        let currentDate;
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        } else {
            console.warn('[PopulationOperations] CalendarService not available. Using fallback date.');
            currentDate = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;

        for (const tileId of tileIds) {
            const populationCount = currentPopulations[tileId];
            await addPeopleToTile(null, tileId, populationCount, currentYear, currentMonth, currentDay, serviceInstance, false);
            console.log(`✅ Regenerated ${populationCount} people for tile ${tileId}`);
        }

        await serviceInstance?.broadcastUpdate('populationRegenerated');
        const populations = await loadPopData();
        console.log('🎉 Population regeneration complete!');

        return formatPopData(populations);
    } catch (error: unknown) {
        console.error('Error regenerating population:', error);
        throw error;
    }
}
