// Population Data Operations - Handles data loading, saving, and formatting
import { getTotalPopulation } from './PopStats';
// Storage removed - all data in Rust ECS

/**
 * Loads tile population counts from Rust ECS (Phase 6)
 * All tile populations are now aggregated on-demand from Rust ECS person queries
 * @param {Pool} pool - Database pool instance (unused, kept for API compatibility)
 * @returns {Object} Population data by tile ID (tile_id -> count)
 */
async function loadPopulationData(pool) {
    try {
        // Phase 6: Tile populations come directly from Rust ECS
        // Chain: PopulationState.getAllTilePopulations() -> rustSimulation.getPopulationByTile()
        // Wait briefly for compatibility
        await new Promise(resolve => setTimeout(resolve, 200));

        try {
            const PopulationState = require('../populationState').default;
            // Poll a few times in case initialization is writing people in batches
            for (let attempt = 0; attempt < 6; attempt++) {
                const populations = await PopulationState.getAllTilePopulations();
                if (Object.keys(populations).length > 0) {
                    return populations;
                }
                // Small backoff between polls
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (e: unknown) {
            console.warn('[loadPopulationData] PopulationState failed:', (e as Error).message);
        }

        // Return empty if no data available
        return {};
    } catch (error: unknown) {
        console.error('Error loading data:', error);
        return {};
    }
}

/**
 * Saves population data from Redis to Postgres
 * @returns {Object} Save result with counts
 */
async function savePopulationData() {
    try {
        const StateManager = require('../stateManager').default;
        const result = await StateManager.saveToDatabase();
        return result;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[dataOperations] savePopulationData failed:', message);
        return { success: false, error: message };
    }
}

/**
 * Formats population data for client consumption
 * @param {Object} populations - Raw population data
 * @returns {Object} Formatted population data
 */
function formatPopulationData(populations: Record<string, number> | null = null) {
    const pops = populations ?? {};
    return {
        tilePopulations: pops,
        totalPopulation: getTotalPopulation(pops),
        totalTiles: Object.keys(pops).length,
        lastUpdated: new Date().toISOString()
    };
}

export {
    loadPopulationData,
    savePopulationData,
    formatPopulationData
};
