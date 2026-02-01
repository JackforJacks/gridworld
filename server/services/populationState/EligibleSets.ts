/**
 * EligibleSets - Matchmaking eligibility sets management
 * 
 * Handles:
 * - Adding/removing people from eligible sets
 * - Querying eligible people for matchmaking
 */

import storage from '../storage';
import { StoredPerson, getErrorMessage } from './types';

/**
 * Add person to eligible set (for matchmaking)
 */
export async function addEligiblePerson(personId: number, isMale: boolean, tileId: number): Promise<boolean> {
    if (!storage.isAvailable()) return false;
    try {
        const setKey = isMale ? `eligible:males:tile:${tileId}` : `eligible:females:tile:${tileId}`;
        const tilesSetKey = isMale ? 'tiles_with_eligible_males' : 'tiles_with_eligible_females';
        await storage.sadd(setKey, personId.toString());
        await storage.sadd(tilesSetKey, tileId.toString());
        return true;
    } catch (err: unknown) {
        console.warn('[EligibleSets] addEligiblePerson failed:', getErrorMessage(err));
        return false;
    }
}

/**
 * Remove person from eligible sets
 * Can be called with just personId (looks up tile_id/sex) or with tileId and sex directly
 */
export async function removeEligiblePerson(
    personId: number,
    tileId?: number,
    sex?: 'male' | 'female'
): Promise<boolean> {
    if (!storage.isAvailable()) return false;
    try {
        const personIdStr = personId.toString();

        // If tileId and sex provided, use them directly (more efficient)
        if (tileId !== undefined && sex !== undefined) {
            const setKey = sex === 'male'
                ? `eligible:males:tile:${tileId}`
                : `eligible:females:tile:${tileId}`;
            await storage.srem(setKey, personIdStr);
            return true;
        }

        // Otherwise look up from person record
        const json = await storage.hget('person', personIdStr);
        if (json) {
            const person = JSON.parse(json) as StoredPerson;
            if (person.tile_id) {
                const setKey = person.sex === true
                    ? `eligible:males:tile:${person.tile_id}`
                    : `eligible:females:tile:${person.tile_id}`;
                await storage.srem(setKey, personIdStr);
            }
        }
        return true;
    } catch (err: unknown) {
        console.warn('[EligibleSets] removeEligiblePerson failed:', getErrorMessage(err));
        return false;
    }
}

/**
 * Get all eligible people for a sex and tile
 */
export async function getEligiblePeople(isMale: boolean, tileId: number): Promise<string[]> {
    if (!storage.isAvailable()) return [];
    const setKey = isMale ? `eligible:males:tile:${tileId}` : `eligible:females:tile:${tileId}`;
    return storage.smembers(setKey);
}
