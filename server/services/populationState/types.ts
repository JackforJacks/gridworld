/**
 * Shared types for populationState modules
 */

/** Internal person data stored in Redis */
export interface StoredPerson {
    id: number;
    tile_id: number | null;
    residency: number | null;
    sex: boolean; // true = male, false = female
    health: number;
    date_of_birth: string | Date;
    family_id: number | null;
    _isNew?: boolean;
}

/** Input person data for add/update operations */
export interface PersonInput {
    id: number;
    tile_id?: number | null;
    residency?: number | null;
    sex?: boolean;
    health?: number;
    date_of_birth?: string | Date;
    family_id?: number | null;
}

/** Partial updates for a person */
export interface PersonUpdates {
    tile_id?: number | null;
    residency?: number | null;
    sex?: boolean;
    health?: number;
    date_of_birth?: string | Date;
    family_id?: number | null;
}

/** Redis pipeline execution result */
export type PipelineResult = [Error | null, unknown][];

/** Residency update batch item */
export interface ResidencyUpdate {
    personId: number;
    newResidency: number;
}

/** ID reassignment mapping */
export interface IdMapping {
    tempId: number;
    newId: number;
}

/** Global population counts */
export interface GlobalCounts {
    total: number;
    male: number;
    female: number;
}

/** Current date for demographics */
export interface CurrentDate {
    year: number;
    month: number;
    day: number;
}

/** Demographic statistics result */
export interface DemographicStats {
    totalPopulation: number;
    male: number;
    female: number;
    minors: number;
    working_age: number;
    elderly: number;
    bachelors: number;
}

/** Helper to extract error message */
export function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err) {
        return String((err as { message: unknown }).message);
    }
    return String(err);
}

/** 
 * Check if sex value represents male (handles various data formats from Postgres/Redis)
 * Supports: true, 'true', 1, 't', 'M'
 */
export function checkIsMale(sex: boolean | string | number | null | undefined): boolean {
    return sex === true || sex === 'true' || sex === 1 || sex === 't' || sex === 'M';
}
