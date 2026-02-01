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
import { repairIfNeeded } from './PopulationSync';

/** Check if sex value represents male (handles various data formats) */
function checkIsMale(sex: boolean | string | number | null | undefined): boolean {
    return sex === true || sex === 'true' || sex === 1 || sex === 't' || sex === 'M';
}

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
            console.warn(`[Demographics] Duplicate memberships detected: ${totalMemberships} memberships for ${totalUnique} unique people. Auto-repairing...`);
            // Auto-repair duplicates
            try {
                await repairIfNeeded();
            } catch (e: unknown) {
                console.warn('[Demographics] Auto-repair failed:', getErrorMessage(e));
            }
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
 * Get demographic statistics - uses HSCAN streaming for memory efficiency
 */
export async function getDemographicStats(currentDate: CurrentDate): Promise<DemographicStats | null> {
    if (!storage.isAvailable()) return null;
    try {
        let totalPopulation = 0;
        let male = 0, female = 0;
        let minors = 0, working_age = 0, elderly = 0;
        let bachelors = 0;

        const peopleStream = storage.hscanStream('person', { count: 500 });
        for await (const result of peopleStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;
                try {
                    const p = JSON.parse(json) as StoredPerson;
                    totalPopulation++;
                    
                    if (checkIsMale(p.sex)) male++;
                    else female++;

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
                            if (checkIsMale(p.sex) && age >= 16 && age <= 45) {
                                bachelors++;
                            } else if (!checkIsMale(p.sex) && age >= 16 && age <= 30) {
                                bachelors++;
                            }
                        }
                    }
                } catch { /* skip invalid */ }
            }
        }

        return {
            totalPopulation,
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
