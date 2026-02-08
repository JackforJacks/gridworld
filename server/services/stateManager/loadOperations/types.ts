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
    people: number;
    families: number;
    male?: number;
    female?: number;
    tiles?: number;
    tilesLands?: number;
    skipped?: boolean;
    seeded?: boolean;
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
}

/** Person row from database */
export interface PersonRow {
    id: number;
    tile_id: number | null;
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

/** People lookup by ID */
export interface PeopleMap {
    [id: number]: PersonRow;
}

