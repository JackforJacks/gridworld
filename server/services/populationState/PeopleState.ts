/**
 * PeopleState - ID allocation only (all person data now managed by Rust ECS)
 *
 * All person data now managed by Rust ECS - use rustSimulation directly
 */

// Re-export types for backward compatibility
export * from './types';

// Import rustSimulation for ID allocation and demographics
import rustSimulation from '../rustSimulation';
import type { DemographicStats, CurrentDate } from './types';

/**
 * PeopleState class - ID allocation only
 * All other methods removed - use rustSimulation directly for person data
 */
class PeopleState {
    // Flag to prevent tick processing during world restart
    static isRestarting: boolean = false;

    // =========== ID ALLOCATION ===========
    static async getNextId(): Promise<number> {
        return rustSimulation.getNextPersonId();
    }

    static async getIdBatch(count: number): Promise<number[]> {
        const ids: number[] = [];
        for (let i = 0; i < count; i++) {
            ids.push(await rustSimulation.getNextPersonId());
        }
        return ids;
    }

    // =========== DEMOGRAPHICS (delegates to Rust ECS) ===========
    static async getDemographicStats(_currentDate: CurrentDate): Promise<DemographicStats> {
        // Get demographics from Rust ECS
        const demo = rustSimulation.getDemographics();

        // Convert to expected format
        // Note: Rust doesn't track minors/working_age/elderly/bachelors separately yet
        // Using placeholder values for now
        return {
            totalPopulation: demo.population,
            male: demo.males,
            female: demo.females,
            minors: 0,
            working_age: 0,
            elderly: 0,
            bachelors: demo.single
        };
    }

    static async getAllTilePopulations(): Promise<{ [tileId: string]: number }> {
        // Get tile populations from Rust ECS
        const tileData = rustSimulation.getPopulationByTile();

        // Convert array to object format
        const result: { [tileId: string]: number } = {};
        for (const { tileId, count } of tileData) {
            result[String(tileId)] = count;
        }
        return result;
    }
}

export default PeopleState;
