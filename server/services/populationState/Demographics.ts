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
    getErrorMessage
} from './types';

/** Check if sex value represents male (handles various data formats) */
function checkIsMale(sex: boolean | string | number | null | undefined): boolean {
    return sex === true || sex === 'true' || sex === 1 || sex === 't' || sex === 'M';
}

/**
 * Get all populations by tile (for statistics)
 * Scans the person hash directly and counts people per tile_id
 */
export async function getAllTilePopulations(): Promise<Record<number, number>> {
    if (!storage.isAvailable()) return {};
    try {
        const tileCounts: Record<number, number> = {};
        const personStream = storage.hscanStream('person', { count: 500 });

        for await (const result of personStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;
                try {
                    const p = JSON.parse(json) as StoredPerson;
                    if (p.tile_id !== null && p.tile_id !== undefined) {
                        tileCounts[p.tile_id] = (tileCounts[p.tile_id] || 0) + 1;
                    }
                } catch { /* skip */ }
            }
        }
        return tileCounts;
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
