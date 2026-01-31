// Family Manager - Helper Functions
import { CalendarService, DateComponents } from './types';
import { CalendarDate } from '../../../../types/global';

/** Parse birth date to components */
export function parseBirthDate(birthDate: string | Date): DateComponents {
    if (typeof birthDate === 'string') {
        const datePart = birthDate.split('T')[0];
        const [year, month, day] = datePart.split('-').map(Number);
        return { year, month, day };
    } else if (birthDate instanceof Date) {
        return {
            year: birthDate.getFullYear(),
            month: birthDate.getMonth() + 1,
            day: birthDate.getDate()
        };
    } else {
        const dateStr = String(birthDate);
        const [year, month, day] = dateStr.split('-').map(Number);
        return { year, month, day };
    }
}

/** Calculate age from birth date and current date */
export function calculateAgeFromDates(
    birthDate: DateComponents,
    currentDate: DateComponents
): number {
    let age = currentDate.year - birthDate.year;
    if (currentDate.month < birthDate.month ||
        (currentDate.month === birthDate.month && currentDate.day < birthDate.day)) {
        age--;
    }
    return age;
}

/** Get current date from calendar service with fallback */
export function getCurrentDate(calendarService: CalendarService | null): CalendarDate {
    if (calendarService && typeof calendarService.getCurrentDate === 'function') {
        return calendarService.getCurrentDate();
    }
    return { year: 1, month: 1, day: 1 };
}

/** Format date as string */
export function formatDate(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Check if person is male (handles various data formats) */
export function isMale(sex: boolean | string | number): boolean {
    return sex === true || sex === 'true' || sex === 1;
}

/** Check if person is female (handles various data formats) */
export function isFemale(sex: boolean | string | number): boolean {
    return sex === false || sex === 'false' || sex === 0;
}
