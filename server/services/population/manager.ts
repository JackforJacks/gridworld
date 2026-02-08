// server/services/population/manager.ts
import { getRandomSex, getRandomAge, getRandomBirthDate } from './calculator';
import { trackBirths, trackDeaths } from './PopStats';
import config from '../../config/server';
import storage from '../storage';
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
    if (!storage.isAvailable()) {
        console.warn('⚠️ Storage not available - cannot add people to tile');
        return;
    }

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

    // Batch add all persons
    await PopulationState.batchAddPersons(persons, true);

    // Add eligible persons to matchmaking sets (only those in eligible age range)
    for (const personObj of persons) {
        try {
            // Calculate age from birthDate
            const birthParts = personObj.date_of_birth.split('-').map(Number);
            const birthYear = birthParts[0];
            let personAge = currentYear - birthYear;
            // Adjust for birthday not yet passed
            if (currentMonth < birthParts[1] || (currentMonth === birthParts[1] && currentDay < birthParts[2])) {
                personAge--;
            }

            const isMale = checkIsMale(personObj.sex);
            const maxAge = isMale ? 45 : 33;

            // Only add to eligible sets if age is in range and they're unmarried
            if (personAge >= 16 && personAge <= maxAge && personObj.family_id === null) {
                await PopulationState.addEligiblePerson(personObj.id, isMale, personObj.tile_id);
            }
        } catch (e: unknown) {
            console.warn('[addPeopleToTile] failed to add eligible person:', e instanceof Error ? e.message : String(e));
        }
    }

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

    // PopulationState is imported at the top of the file
    if (!storage.isAvailable()) {
        console.warn('⚠️ Storage not available - cannot remove people from tile');
        return;
    }

    // Collect people on this tile using HSCAN streaming (memory efficient)
    const tilePopulation: Array<{ id: number; tile_id: number }> = [];
    const peopleStream = storage.hscanStream('person', { count: 500 });

    for await (const result of peopleStream) {
        const entries = result as string[];
        for (let i = 0; i < entries.length; i += 2) {
            const json = entries[i + 1];
            if (!json) continue;
            try {
                const p = JSON.parse(json) as { id: number; tile_id: number };
                if (p.tile_id === tileId) {
                    tilePopulation.push(p);
                }
            } catch { /* skip invalid */ }
        }
        // Early exit if we have enough candidates (we need at least count)
        if (tilePopulation.length >= count * 2) break;
    }

    // Randomly select people to remove
    const shuffled = tilePopulation.sort(() => Math.random() - 0.5);
    const toRemove = shuffled.slice(0, Math.min(count, shuffled.length));

    // Batch remove all persons
    const personIds = toRemove.map(p => p.id);
    await PopulationState.batchRemovePersons(personIds, true);

    if (doTrackDeaths && populationServiceInstance && typeof trackDeaths === 'function') {
        trackDeaths(populationServiceInstance, toRemove.length);
    }
}

export { addPeopleToTile, removePeopleFromTile };
