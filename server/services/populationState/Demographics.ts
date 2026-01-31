/**
 * Demographics - Population statistics and tile population counts
 * 
 * Handles:
 * - getAllTilePopulations
 * - getDemographicStats
 */

import storage from '../storage';
import { 
    StoredPerson, 
    CurrentDate, 
    DemographicStats, 
    PipelineResult,
    getErrorMessage 
} from './types';
import { getAllPeople } from './PersonCrud';

/**
 * Get all populations by tile (for statistics)
 * Optimized: Single pass with deduplication
 */
export async function getAllTilePopulations(): Promise<Record<number, number>> {
    if (!storage.isAvailable()) return {};
    try {
        const tileSets = new Map<number, Set<string>>();
        let totalMemberships = 0;
        const stream = storage.scanStream({ match: 'village:*:*:people', count: 100 });

        for await (const keys of stream) {
            if (!Array.isArray(keys) || keys.length === 0) continue;

            const pipeline = storage.pipeline();
            for (const key of keys) pipeline.smembers(key);
            const results = await pipeline.exec() as PipelineResult;

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i] as string;
                const parts = key.split(':');
                if (parts.length !== 4) continue;
                const tileId = parseInt(parts[1], 10);
                const [err, members] = results[i];
                if (err || !Array.isArray(members)) continue;

                totalMemberships += members.length;
                if (!tileSets.has(tileId)) tileSets.set(tileId, new Set());
                const set = tileSets.get(tileId)!;
                for (const id of members) set.add(String(id));
            }
        }

        const result: Record<number, number> = {};
        let totalUnique = 0;
        for (const [tileId, set] of tileSets.entries()) {
            result[tileId] = set.size;
            totalUnique += set.size;
        }

        if (totalMemberships > totalUnique) {
            console.warn(`[Demographics] Duplicate memberships detected: ${totalMemberships} memberships for ${totalUnique} unique people. Run repairIfNeeded() to fix.`);
        }

        return result;
    } catch (err: unknown) {
        console.warn('[Demographics] getAllTilePopulations failed:', getErrorMessage(err));
        return {};
    }
}

/**
 * Calculate age from date of birth
 */
function calculateAge(dateOfBirth: string | Date, currentDate: CurrentDate): number | null {
    const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;
    
    let birthYear: number, birthMonth: number, birthDay: number;
    
    if (typeof dateOfBirth === 'string') {
        const datePart = dateOfBirth.split('T')[0];
        [birthYear, birthMonth, birthDay] = datePart.split('-').map(Number);
    } else if (dateOfBirth instanceof Date) {
        birthYear = dateOfBirth.getFullYear();
        birthMonth = dateOfBirth.getMonth() + 1;
        birthDay = dateOfBirth.getDate();
    } else {
        return null;
    }

    let age = currentYear - birthYear;
    if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
        age--;
    }
    return age;
}

/**
 * Get demographic statistics
 */
export async function getDemographicStats(currentDate: CurrentDate): Promise<DemographicStats | null> {
    if (!storage.isAvailable()) return null;
    try {
        const people = await getAllPeople();

        let male = 0, female = 0;
        let minors = 0, working_age = 0, elderly = 0;
        let bachelors = 0;

        for (const p of people) {
            if (p.sex === true) male++;
            else if (p.sex === false) female++;

            if (p.date_of_birth) {
                const age = calculateAge(p.date_of_birth, currentDate);
                if (age === null) continue;

                if (age < 16) {
                    minors++;
                } else if (age > 60) {
                    elderly++;
                } else {
                    working_age++;
                }

                // Bachelors: unmarried adults (male 16-45, female 16-30)
                if (!p.family_id) {
                    if (p.sex === true && age >= 16 && age <= 45) {
                        bachelors++;
                    } else if (p.sex === false && age >= 16 && age <= 30) {
                        bachelors++;
                    }
                }
            }
        }

        return {
            totalPopulation: people.length,
            male,
            female,
            minors,
            working_age,
            elderly,
            bachelors
        };
    } catch (err: unknown) {
        console.error('[Demographics] getDemographicStats failed:', getErrorMessage(err));
        return null;
    }
}
