// Population Operations - Helper Functions
import { Pool } from 'pg';
import * as deps from '../dependencyContainer';
import {
    TilePopulations,
    FormattedPopulationData,
    PopulationStateModule
} from './types';

// Re-export centralized age calculation for backward compatibility
export { getAge } from '../../../utils/ageCalculation';

/** Helper function to format population data with proper typing */
export function formatPopData(populations: TilePopulations | null = null): FormattedPopulationData {
    const pops = populations ?? {};
    let total = 0;
    for (const key of Object.keys(pops)) {
        total += pops[key] || 0;
    }
    return {
        tilePopulations: pops,
        totalPopulation: total,
        totalTiles: Object.keys(pops).length,
        lastUpdated: new Date().toISOString()
    };
}

/** Helper function to load population data with proper typing */
export async function loadPopData(_pool: Pool): Promise<TilePopulations> {
    try {
        const PopulationState = deps.getPopulationState() as unknown as PopulationStateModule | null;
        if (PopulationState) {
            const populations = await PopulationState.getAllTilePopulations();
            if (Object.keys(populations).length > 0) {
                return populations;
            }
        }
        return {};
    } catch (error: unknown) {
        console.error('Error loading population data:', error);
        return {};
    }
}
