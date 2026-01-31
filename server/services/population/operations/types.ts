// Population Operations - Shared Type Definitions
import { Pool } from 'pg';

/** Calendar date structure */
export interface CalendarDate {
    year: number;
    month: number;
    day: number;
}

/** Calendar service interface */
export interface CalendarService {
    getCurrentDate(): CalendarDate;
    getState(): { currentDate: CalendarDate } | null;
}

/** Population service interface */
export interface PopulationServiceInstance {
    broadcastUpdate(eventType: string): Promise<void>;
}

/** Options for population operations */
export interface PopulationOptions {
    preserveDatabase?: boolean | string;
    forceAll?: boolean;
}

/** Tile populations mapping */
export interface TilePopulations {
    [tileId: string]: number;
}

/** Formatted population data returned to clients */
export interface FormattedPopulationData {
    tilePopulations: TilePopulations;
    totalPopulation: number;
    totalTiles: number;
    lastUpdated: string;
    success?: boolean;
    message?: string;
    isExisting?: boolean;
}

/** Person data structure for population operations */
export interface PersonRecord {
    id: number;
    tile_id: number;
    residency: number;
    sex: boolean;
    date_of_birth: string;
    family_id: number | null;
}

/** Family data structure for population operations */
export interface FamilyRecord {
    id: number;
    husband_id: number;
    wife_id: number;
    tile_id: number;
    pregnancy: boolean;
    delivery_date: string | null;
    children_ids: number[];
}

/** Population state module interface */
export interface PopulationStateModule {
    getTotalPopulation(): Promise<number>;
    getAllTilePopulations(): Promise<TilePopulations>;
    rebuildVillageMemberships(): Promise<{ success: boolean; total: number }>;
    addPerson(person: PersonRecord, isNew: boolean): Promise<void>;
    addFamily(family: FamilyRecord, isNew: boolean): Promise<void>;
    batchAddPersons(persons: PersonRecord[], isNew: boolean): Promise<number>;
    batchAddFamilies(families: FamilyRecord[], isNew: boolean): Promise<number>;
}

/** Calculator module interface */
export interface CalculatorModule {
    getRandomSex(): boolean;
    getRandomAge(): number;
    getRandomBirthDate(year: number, month: number, day: number, age: number): string;
}

/** Tile population map for tracking people per tile */
export interface TilePopulationMap {
    [tileId: number]: PersonRecord[];
}

/** Tile population targets for tracking intended counts */
export interface TilePopulationTargets {
    [tileId: number]: number;
}
