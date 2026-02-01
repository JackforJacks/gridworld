// Population Operations - Population Updater Module
import { Pool } from 'pg';
import { Procreation } from '../family';
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
    pool: Pool,
    calendarService: CalendarService | null,
    serviceInstance: PopulationServiceInstance,
    tileId: string | number,
    population: number
): Promise<void> {
    await Procreation(pool, calendarService, serviceInstance, Number(tileId), population);
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
    pool: Pool,
    calendarService: CalendarService | null,
    serviceInstance: PopulationServiceInstance,
    tilePopulations: TilePopulations
): Promise<FormattedPopulationData> {
    if (!tilePopulations || typeof tilePopulations !== 'object') {
        throw new Error('tilePopulations must be an object');
    }

    let totalUpdated = 0;
    for (const [tileId, population] of Object.entries(tilePopulations)) {
        if (typeof population === 'number' && population >= 0) {
            await updateTilePopulation(pool, calendarService, serviceInstance, tileId, population);
            totalUpdated++;
        }
    }

    const populations = await loadPopData(pool);
    return formatPopData(populations);
}

/**
 * Regenerates population with new age distribution
 * @param pool - Database pool instance
 * @param calendarService - Calendar service instance
 * @param serviceInstance - Population service instance
 * @returns Formatted population data
 */
export async function regeneratePopulationWithNewAgeDistribution(
    pool: Pool,
    calendarService: CalendarService | null,
    serviceInstance: PopulationServiceInstance
): Promise<FormattedPopulationData> {
    try {
        console.log('🔄 Regenerating population with new age distribution...');

        const existingPopulations = await loadPopData(pool);
        const tileIds = Object.keys(existingPopulations);

        if (tileIds.length === 0) {
            console.log('No existing population found to regenerate');
            return formatPopData({});
        }

        const currentPopulations = { ...existingPopulations };
        // Clear storage population data first
        await clearStoragePopulation();
        await pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');

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
            await addPeopleToTile(pool, tileId, populationCount, currentYear, currentMonth, currentDay, serviceInstance, false);
            console.log(`✅ Regenerated ${populationCount} people for tile ${tileId}`);
        }

        await serviceInstance.broadcastUpdate('populationRegenerated');
        const populations = await loadPopData(pool);
        console.log('🎉 Population regeneration complete!');

        return formatPopData(populations);
    } catch (error: unknown) {
        console.error('Error regenerating population:', error);
        throw error;
    }
}
