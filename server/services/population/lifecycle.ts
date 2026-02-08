// Population Lifecycle Management - Handles growth and life cycle events
import config from '../../config/server';

// ===== Type Definitions =====

/** Population service instance interface */
interface PopulationServiceInstance {
    growthInterval: ReturnType<typeof setInterval> | null;
    io: { emit: (event: string, data: unknown) => void } | null;
    loadData(): Promise<{ [tileId: string]: number }>;
    updatePopulation(tileId: string, population: number): Promise<void>;
    broadcastUpdate(): Promise<void>;
    getAllPopulationData(): Promise<PopulationData>;
}

/** Population data structure */
interface PopulationData {
    tilePopulations: { [tileId: string]: number };
    totalPopulation: number;
    totalTiles: number;
    lastUpdated: string;
}

/**
 * Starts population growth simulation
 */
function startGrowth(serviceInstance: PopulationServiceInstance): void {
    stopGrowth(serviceInstance);
    serviceInstance.growthInterval = setInterval(async () => {
        try {
            await updatePopulations(serviceInstance);
        } catch (error: unknown) {
            console.error('Error updating populations:', error);
        }
    }, config.populationGrowthInterval);
}

/**
 * Stops population growth simulation
 */
function stopGrowth(serviceInstance: PopulationServiceInstance): void {
    if (serviceInstance.growthInterval) {
        clearInterval(serviceInstance.growthInterval);
        serviceInstance.growthInterval = null;
    }
}

/**
 * Updates all populations based on growth rate
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
 */
function calculateGrowthForTile(_tileId: string | number, baseGrowthRate: number): number {
    return baseGrowthRate;
}

/**
 * Updates growth rate configuration
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
 * Applies senescence - deprecated, handled by Rust death_system
 */
async function applySenescence(
    _pool: unknown,
    _calendarService: unknown,
    _populationServiceInstance: unknown,
    _daysAdvanced: number = 1
): Promise<number> {
    return 0;
}

export {
    startGrowth,
    stopGrowth,
    updatePopulations,
    calculateGrowthForTile,
    updateGrowthRate,
    applySenescence
};

export type { PopulationData };
