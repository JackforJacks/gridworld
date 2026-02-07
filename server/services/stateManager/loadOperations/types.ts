// Load Operations - Shared Type Definitions
import { Server as SocketIOServer } from 'socket.io';

/** Calendar date structure */
export interface CalendarDate {
    year: number;
    month: number;
    day: number;
}

/** Calendar service state */
export interface CalendarState {
    isRunning: boolean;
    currentDate?: CalendarDate;
}

/** Calendar service interface */
export interface CalendarService {
    state?: CalendarState;
    start: () => void;
    stop: () => void;
    getState?: () => CalendarState;
    loadStateFromDB?: () => Promise<void>;
}

/** Load context passed to loadFromDatabase */
export interface LoadContext {
    calendarService?: CalendarService;
    io?: SocketIOServer;
}

/** Result from loading or seeding */
export interface LoadResult {
    villages: number;
    people: number;
    families: number;
    male?: number;
    female?: number;
    tiles?: number;
    tilesLands?: number;
    skipped?: boolean;
    seeded?: boolean;
}

/** Result from seedWorldIfEmpty */
export interface SeedWorldResult {
    seeded: boolean;
    people: number;
    villages: number;
    tiles?: number;
}

/** Pipeline interface (subset of ioredis ChainableCommander) */
export interface Pipeline {
    hset(key: string, field: string, value: string): Pipeline;
    sadd(key: string, member: string): Pipeline;
    exec(): Promise<unknown[]>;
}

/** Tile row from database */
export interface TileRow {
    id: number;
    center_x: number;
    center_y: number;
    center_z: number;
    latitude: number;
    longitude: number;
    terrain_type: string;
    boundary_points: unknown;
    neighbor_ids: number[];
    biome: string | null;
    fertility: number | null;
}

/** Land row from database */
export interface LandRow {
    tile_id: number;
    chunk_index: number;
    land_type: string;
    cleared: boolean;
    owner_id: number | null;
    village_id: number | null;
}

/** Village row from database */
export interface VillageRow {
    id: number;
    tile_id: number;
    land_chunk_index: number;
    name: string;
    food_stores: string | number;
    food_capacity: string | number;
    food_production_rate: string | number;
    housing_capacity: string | number;
    housing_slots: number[] | string | null;
}

/** Person row from database */
export interface PersonRow {
    id: number;
    tile_id: number | null;
    residency: number | null;
    sex: boolean | string | number;
    health: number | null;
    family_id: number | null;
    date_of_birth: string;
}

/** Family row from database */
export interface FamilyRow {
    id: number;
    husband_id: number | null;
    wife_id: number | null;
    tile_id: number;
    pregnancy: boolean | null;
    delivery_date: string | null;
    children_ids: number[] | null;
}

/** People load result */
export interface LoadPeopleResult {
    people: PersonRow[];
    maleCount: number;
    femaleCount: number;
}

/** Land count row from query */
export interface LandCountRow {
    village_id: number;
    cleared_cnt: string;
}

/** Lands grouped by tile */
export interface LandsByTile {
    [tileId: string]: Array<{
        tile_id: number;
        chunk_index: number;
        land_type: string;
        cleared: boolean;
        owner_id: number | null;
        village_id: number | null;
    }>;
}

/** People lookup by ID */
export interface PeopleMap {
    [id: number]: PersonRow;
}

/** Village ID lookup by tile:chunk key */
export interface VillageIdLookup {
    [key: string]: number;
}

/** Validation issue from VillageManager */
export interface ValidationIssue {
    type: string;
    tileId: number;
}
