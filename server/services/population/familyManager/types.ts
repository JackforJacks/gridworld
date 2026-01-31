// Family Manager - Shared Type Definitions
import { CalendarDate } from '../../../../types/global';

/** Calendar service interface for dependency injection */
export interface CalendarService {
    getCurrentDate(): CalendarDate;
}

/** Population service interface for birth tracking */
export interface PopulationServiceInstance {
    trackBirths?(count: number): void;
}

/** Person record type (from Redis/PopulationState) */
export interface PersonRecord {
    id: number;
    tile_id: number;
    residency?: number;
    sex: boolean | string | number;
    date_of_birth: string | Date;
    health?: number;
    family_id?: number | null;
}

/** Family record type */
export interface FamilyRecord {
    id: number;
    husband_id: number;
    wife_id: number;
    tile_id: number;
    pregnancy: boolean;
    delivery_date: string | null;
    children_ids: number[];
}

/** Baby delivery result type */
export interface DeliveryResult {
    baby: {
        id: number;
        sex: boolean;
        birthDate: string;
    };
    family: FamilyRecord;
}

/** Family statistics result type */
export interface FamilyStats {
    totalFamilies: number;
    pregnantFamilies: number;
    avgChildrenPerFamily: number;
}

/** Date components */
export interface DateComponents {
    year: number;
    month: number;
    day: number;
}
