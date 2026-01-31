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
        const sex = isMale ? 'male' : 'female';
        await storage.sadd(`eligible:${sex}:${tileId}`, personId.toString());
        return true;
    } catch (err: unknown) {
        console.warn('[EligibleSets] addEligiblePerson failed:', getErrorMessage(err));
        return false;
    }
}

/**
 * Remove person from eligible sets
 * Optimized: Uses person's tile_id and sex to target specific key instead of scanning
 */
export async function removeEligiblePerson(personId: number): Promise<boolean> {
    if (!storage.isAvailable()) return false;
    try {
        const personIdStr = personId.toString();
        const json = await storage.hget('person', personIdStr);
        if (json) {
            const person = JSON.parse(json) as StoredPerson;
            if (person.tile_id) {
                const sex = person.sex === true ? 'male' : 'female';
                await storage.srem(`eligible:${sex}:${person.tile_id}`, personIdStr);
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
    const sex = isMale ? 'male' : 'female';
    return storage.smembers(`eligible:${sex}:${tileId}`);
}
