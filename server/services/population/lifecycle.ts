// Population Lifecycle Management - Handles growth, aging, and life cycle events
import config from '../../config/server';
// Storage removed - all data in Rust ECS
import * as deps from './dependencyContainer';
import { checkIsMale } from '../populationState/types';
import {
    DAYS_PER_YEAR,
    SENESCENCE_START_AGE,
    BASE_ANNUAL_DEATH_CHANCE,
    DEATH_CHANCE_INCREASE_PER_YEAR
} from '../../config/gameBalance';
import { CalendarDate, PersonData } from '../../../types/global';
// All family data now managed by Rust ECS - use rustSimulation.getDemographics()

// ===== Type Definitions =====

/** Calendar service interface */
interface CalendarService {
    getCurrentDate(): CalendarDate;
    getState(): { currentDate: CalendarDate } | null;
}

/** Population service instance interface */
interface PopulationServiceInstance {
    growthInterval: ReturnType<typeof setInterval> | null;
    io: { emit: (event: string, data: unknown) => void } | null;
    loadData(): Promise<{ [tileId: string]: number }>;
    updatePopulation(tileId: string, population: number): Promise<void>;
    broadcastUpdate(): Promise<void>;
    getAllPopulationData(): Promise<PopulationData>;
    trackDeaths?(count: number): void;
    trackBirths?(count: number): void;
}

/** Population data structure */
interface PopulationData {
    tilePopulations: { [tileId: string]: number };
    totalPopulation: number;
    totalTiles: number;
    lastUpdated: string;
}

/** Residency update structure */
interface ResidencyUpdate {
    personId: number;
    newResidency: number;
}

/** PopulationState module interface (legacy - most methods deprecated) */
interface PopulationStateModule {
    isRestarting: boolean;
    getAllPeople(): Promise<PersonData[]>;
    getPerson(personId: number): Promise<PersonData | null>;
    updatePerson(personId: number, updates: Partial<PersonData>): Promise<void>;
    batchRemovePersons(personIds: number[], markForDeletion: boolean): Promise<void>;
    batchUpdateResidency(updates: ResidencyUpdate[]): Promise<void>;
    // Family methods removed - use rustSimulation.getDemographics() instead
    // Matchmaking removed - handled by Rust ECS
}

/** Calculator module interface */
interface CalculatorModule {
    calculateAge(birthDate: string, currentYear: number, currentMonth: number, currentDay: number): number;
}

/**
 * Starts population growth simulation
 * @param serviceInstance - The population service instance
 */
function startGrowth(serviceInstance: PopulationServiceInstance): void {
    stopGrowth(serviceInstance);
    serviceInstance.growthInterval = setInterval(async () => {
        try {
            await updatePopulations(serviceInstance);
        } catch (error: unknown) {
            console.error('❌ Error updating populations:', error);
        }
    }, config.populationGrowthInterval);
    // Population growth started. (log suppressed)
}

/**
 * Stops population growth simulation
 * @param serviceInstance - The population service instance
 */
function stopGrowth(serviceInstance: PopulationServiceInstance): void {
    if (serviceInstance.growthInterval) {
        clearInterval(serviceInstance.growthInterval);
        serviceInstance.growthInterval = null;
    }
}

/**
 * Updates all populations based on growth rate
 * @param serviceInstance - The population service instance
 */
async function updatePopulations(serviceInstance: PopulationServiceInstance): Promise<void> {
    const populations = await serviceInstance.loadData();
    const habitableTileIds = Object.keys(populations);

    if (habitableTileIds.length === 0) return;

    const growthRate = config.defaultGrowthRate;
    let totalGrowth = 0;

    for (const tileId of habitableTileIds) {
        const growth = calculateGrowthForTile(tileId, growthRate);
        const currentPopulation = populations[tileId];
        const newPopulation = currentPopulation + growth;
        totalGrowth += growth;

        if (growth !== 0) {
            await serviceInstance.updatePopulation(tileId, newPopulation);
        }
    }

    if (totalGrowth > 0) {
        await serviceInstance.broadcastUpdate();
    }
}

/**
 * Calculates growth for a specific tile
 * @param tileId - The tile ID
 * @param baseGrowthRate - Base growth rate
 * @returns Growth amount
 */
function calculateGrowthForTile(tileId: string | number, baseGrowthRate: number): number {
    // Basic growth rate implementation
    // This could be enhanced with more complex factors like:
    // - Resource availability
    // - Population density
    // - Environmental factors
    return baseGrowthRate;
}

/**
 * Updates growth rate configuration
 * @param serviceInstance - The population service instance
 * @param rate - New growth rate
 * @returns Updated population data
 */
async function updateGrowthRate(serviceInstance: PopulationServiceInstance, rate: number): Promise<PopulationData> {
    if (typeof rate !== 'number' || rate < 0) {
        throw new Error('Growth rate must be a non-negative number');
    }

    const responseData = await serviceInstance.getAllPopulationData();
    if (serviceInstance.io) {
        serviceInstance.io.emit('populationUpdate', responseData);
    }
    return responseData;
}

/**
 * Applies senescence (aging deaths) to the population - storage-only (Postgres deletes happen on Save)
 * @param pool - Database pool instance (used for family queries only)
 * @param calendarService - Calendar service instance
 * @param populationServiceInstance - Population service instance
 * @param daysAdvanced - Number of days that passed in this tick (default 1)
 * @returns Number of deaths
 */
async function applySenescence(
    _pool: unknown,
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    daysAdvanced: number = 1
): Promise<number> {
    try {
        const PopulationState = deps.getPopulationState() as unknown as PopulationStateModule | null;

        if (!PopulationState) {
            console.warn('⚠️ PopulationState not available - cannot process senescence');
            return 0;
        }
        // Storage removed - all data in Rust ECS

        let currentYear = 4000, currentMonth = 1, currentDay = 1;
        try {
            if (calendarService && typeof calendarService.getState === 'function') {
                const state = calendarService.getState();
                if (state && state.currentDate) {
                    currentYear = state.currentDate.year;
                    currentMonth = state.currentDate.month;
                    currentDay = state.currentDate.day;
                }
            }
        } catch (e: unknown) {
            console.warn('Using fallback calendar date for senescence due to error:', e);
        }

        const calculator = deps.getCalculator() as CalculatorModule | null;
        if (!calculator) {
            console.warn('⚠️ Calculator not available - cannot process senescence');
            return 0;
        }

        // Storage removed - all data in Rust ECS
        // Deaths are handled by Rust simulation via tick()
        // This function is deprecated - senescence logic is now in Rust ECS
        return 0;
    } catch (error: unknown) {
        console.error('Error applying senescence:', error);
        return 0;
    }
}

// processDailyFamilyEvents removed - now handled by Rust simulation

export {
    startGrowth,
    stopGrowth,
    updatePopulations,
    calculateGrowthForTile,
    updateGrowthRate,
    applySenescence
};

export type { PopulationData };
