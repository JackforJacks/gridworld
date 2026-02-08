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

    // =========== PERSON QUERIES (Phase 5 - delegates to Rust ECS) ===========

    /**
     * Get all people from Rust ECS
     * Returns data in legacy PersonData format for backward compatibility
     */
    static async getAllPeople(): Promise<any[]> {
        const rustPeople = rustSimulation.getAllPeople();

        // Convert Rust Person to legacy PersonData format
        return rustPeople.map(p => ({
            id: p.id,
            tile_id: p.tileId,
            sex: p.sex, // true = male, false = female (matches both formats)
            date_of_birth: `${p.birthYear}-${String(p.birthMonth).padStart(2, '0')}-${String(p.birthDay).padStart(2, '0')}`,
            family_id: null, // deprecated
            first_name: p.firstName,
            last_name: p.lastName,
            age_years: p.ageYears,
            is_partnered: p.isPartnered,
            is_pregnant: p.isPregnant,
            partner_id: p.partnerId
        }));
    }

    /**
     * Get a specific person by ID from Rust ECS
     * Returns data in legacy PersonData format for backward compatibility
     */
    static async getPerson(personId: number): Promise<any | null> {
        const rustPerson = rustSimulation.getPerson(personId);

        if (!rustPerson) {
            return null;
        }

        // Convert Rust Person to legacy PersonData format
        return {
            id: rustPerson.id,
            tile_id: rustPerson.tileId,
            sex: rustPerson.sex,
            date_of_birth: `${rustPerson.birthYear}-${String(rustPerson.birthMonth).padStart(2, '0')}-${String(rustPerson.birthDay).padStart(2, '0')}`,
            family_id: null, // deprecated
            first_name: rustPerson.firstName,
            last_name: rustPerson.lastName,
            age_years: rustPerson.ageYears,
            is_partnered: rustPerson.isPartnered,
            is_pregnant: rustPerson.isPregnant,
            partner_id: rustPerson.partnerId
        };
    }

    // =========== WRITE OPERATIONS (Not yet implemented in Rust) ===========

    /**
     * Update person data
     * @deprecated Person updates should happen via Rust simulation systems
     */
    static async updatePerson(_personId: number, _updates: any): Promise<void> {
        console.warn('⚠️ updatePerson not implemented - person state is managed by Rust ECS');
        // Person state changes should happen through Rust simulation systems (matchmaking, family, etc.)
    }

    /**
     * Batch remove persons
     * @deprecated Person removal should happen via Rust simulation death system
     */
    static async batchRemovePersons(_personIds: number[], _markForDeletion: boolean): Promise<void> {
        console.warn('⚠️ batchRemovePersons not implemented - deaths are managed by Rust ECS');
        // Deaths are handled by Rust death_system during tick()
    }

    /**
     * Batch update residency
     * @deprecated Person migration should happen via Rust simulation systems
     */
    static async batchUpdateResidency(_updates: Array<{ personId: number; newResidency: number }>): Promise<void> {
        console.warn('⚠️ batchUpdateResidency not implemented - migration will be managed by Rust ECS');
        // Future: implement migration system in Rust
    }
}

export default PeopleState;
