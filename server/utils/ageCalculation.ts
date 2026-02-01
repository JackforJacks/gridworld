/**
 * Age Calculation Utility - Single source of truth for age calculations
 * 
 * Centralizes age calculation logic to avoid duplication across:
 * - server/services/population/calculator.ts
 * - server/services/population/operations/helpers.ts
 * - and other files that need age calculations
 */

export interface DateComponents {
    year: number;
    month: number;
    day: number;
}

/**
 * Parse a birth date string or Date object into components
 * Handles: 'YYYY-MM-DD', ISO strings like '2024-01-15T22:00:00.000Z', and Date objects
 */
export function parseBirthDate(birthDate: string | Date): DateComponents | null {
    if (typeof birthDate === 'string') {
        // Handle ISO date strings by extracting just the date part
        // e.g., '4033-10-01T22:00:00.000Z' -> '4033-10-01'
        const dateOnly = birthDate.includes('T') ? birthDate.split('T')[0] : birthDate;
        const parts = dateOnly.split('-').map(Number);
        if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
            return { year: parts[0], month: parts[1], day: parts[2] };
        }
        return null;
    } else if (birthDate instanceof Date) {
        return {
            year: birthDate.getFullYear(),
            month: birthDate.getMonth() + 1, // JS months are 0-indexed
            day: birthDate.getDate()
        };
    }
    return null;
}

/**
 * Calculate age from birth date components and current date components
 * 
 * @param birthDate - Birth date as 'YYYY-MM-DD' string or Date object
 * @param currentYear - Current year
 * @param currentMonth - Current month (1-12)
 * @param currentDay - Current day (1-31)
 * @returns Age in years, or 0 if birth date is invalid
 */
export function calculateAge(
    birthDate: string | Date,
    currentYear: number,
    currentMonth: number,
    currentDay: number
): number {
    const birth = parseBirthDate(birthDate);
    if (!birth) {
        console.error('Invalid birthDate format:', birthDate);
        return 0;
    }

    let age = currentYear - birth.year;

    // Adjust if birthday hasn't occurred yet this year
    if (currentMonth < birth.month ||
        (currentMonth === birth.month && currentDay < birth.day)) {
        age--;
    }

    return Math.max(0, age);
}

/**
 * Alias for calculateAge for backward compatibility with helpers.ts
 */
export const getAge = calculateAge;
