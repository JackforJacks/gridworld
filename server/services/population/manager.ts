// server/services/population/manager.ts
import { getRandomSex, getRandomAge, getRandomBirthDate } from './calculator';
import { trackBirths, trackDeaths } from './PopStats';
import config from '../../config/server';
// Storage removed - all data in Rust ECS
import PopulationState from '../populationState';
import { checkIsMale } from '../populationState/types';

/**
 * Add people to a tile - storage-only (Postgres writes happen on Save)
 * Optimized: Uses batch operations for better Redis performance
 * @param {Pool} pool - Database pool (used for fallback/queries only)
 * @param {number} tileId - Tile ID
 * @param {number} count - Number of people to add
 * @param {number} currentYear - Current year
 * @param {number} currentMonth - Current month
 * @param {number} currentDay - Current day
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {boolean} doTrackBirths - Whether to track births
 */
async function addPeopleToTile(pool, tileId, count, currentYear, currentMonth, currentDay, populationServiceInstance, doTrackBirths = false) {
    // PopulationState is imported at the top of the file
    // Storage removed - all data in Rust ECS
    console.warn('⚠️ addPeopleToTile deprecated - use rustSimulation.seedPopulationOnTileRange() instead');
    return;

    // Dead code below (unreachable)
    // Pre-allocate IDs in batch
    const ids = await PopulationState.getIdBatch(count);

    // Build all person objects
    interface PersonObj {
        id: number;
        tile_id: number;
        residency: number;
        sex: boolean;
        date_of_birth: string;
        health: number;
        family_id: null;
    }
    const persons: PersonObj[] = [];
    for (let i = 0; i < count; i++) {
        const sex = getRandomSex();
        const age = getRandomAge();
        const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);

        persons.push({
            id: ids[i],
            tile_id: tileId,
            residency: tileId,
            sex: sex,
            date_of_birth: birthDate,
            health: 100,
            family_id: null
        });
    }

    // Person data removed - all managed by Rust ECS
    // Use rustSimulation.seedPopulationOnTileRange() instead

    if (doTrackBirths && populationServiceInstance && typeof trackBirths === 'function') {
        trackBirths(populationServiceInstance, count);
    }
}

/**
 * Remove people from a tile - storage-only (Postgres deletes happen on Save)
 * Optimized: Uses HSCAN streaming to avoid loading all people into memory
 * @param {Pool} pool - Database pool (used for queries only)
 * @param {number} tileId - Tile ID
 * @param {number} count - Number of people to remove
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {boolean} doTrackDeaths - Whether to track deaths
 */
async function removePeopleFromTile(pool, tileId, count, populationServiceInstance, doTrackDeaths = false) {
    if (count <= 0) return;

    // Storage removed - all data in Rust ECS
    console.warn('⚠️ removePeopleFromTile deprecated - use rustSimulation directly');
    return;
}

export { addPeopleToTile, removePeopleFromTile };
