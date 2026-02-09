/**
 * ApiClient - Centralized Tauri IPC service
 *
 * Replaces the old HTTP fetch-based API client with Tauri invoke() calls.
 * All methods call Rust #[tauri::command] functions via IPC.
 */

import { invoke } from '@tauri-apps/api/core';

// ==================== Types matching Rust structs (snake_case) ====================

/** App config from Rust get_config command */
export interface AppConfig {
    hexasphere: HexasphereConfig;
    calendar: CalendarConfig;
    seed: number;
}

/** Hexasphere configuration */
export interface HexasphereConfig {
    radius: number;
    subdivisions: number;
    tile_width_ratio: number;
}

/** Calendar configuration */
export interface CalendarConfig {
    days_per_month: number;
    months_per_year: number;
    start_year: number;
}

/** Calendar date */
export interface CalendarDate {
    year: number;
    month: number;
    day: number;
}

/** Calendar state from Rust */
export interface CalendarState {
    date: CalendarDate;
    is_paused: boolean;
    current_speed: string;
}

/** Speed mode configuration */
export interface SpeedMode {
    key: string;
    name: string;
    interval_ms: number;
}

/** Tile properties from Rust calculate_tile_properties */
export interface TileProperties {
    id: number;
    terrain_type: string;
    biome: string | null;
    fertility: number;
    is_habitable: boolean;
}

/** Tile center for calculate_tile_properties input */
export interface TileCenter {
    id: number;
    x: number;
    y: number;
    z: number;
}

/** Person data from Rust */
export interface PersonData {
    id: number;
    first_name: string;
    last_name: string;
    tile_id: number;
    sex: boolean;
    birth_year: number;
    birth_month: number;
    birth_day: number;
    age_years: number;
    is_partnered: boolean;
    is_pregnant: boolean;
    partner_id: number | null;
}

/** Demographics from Rust */
export interface Demographics {
    population: number;
    males: number;
    females: number;
    partnered: number;
    single: number;
    pregnant: number;
    average_age: number;
    age_brackets: [number, number, number, number, number, number, number];
}

/** Vital statistics from Rust */
export interface VitalStatistics {
    birth_rate: number;
    death_rate: number;
    marriage_rate: number;
    natural_increase_rate: number;
    total_births: number;
    total_deaths: number;
    total_marriages: number;
    population: number;
    years_covered: number;
}

/** Event data from Rust */
export interface EventData {
    event_type: string;
    year: number;
    month: number;
    day: number;
    person_id: number | null;
}

/** Tile population data */
export interface TilePopulationData {
    tile_id: number;
    count: number;
}

/** Save result from Rust */
export interface SaveResult {
    population: number;
    file_bytes: number;
}

/** Load result from Rust */
export interface LoadResult {
    population: number;
    partners: number;
    calendar_year: number;
    seed: number;
}

/** Memory usage from Rust process */
export interface MemoryUsage {
    physical_mem: number;
}

/** Restart result from Rust */
export interface RestartResult {
    seed: number;
    population: number;
    tiles: number;
    calendar: CalendarDate;
}

/** Tick event from Rust (also used as calendar-tick event payload) */
export interface TickEvent {
    births: number;
    deaths: number;
    marriages: number;
    pregnancies: number;
    dissolutions: number;
    population: number;
    year: number;
    month: number;
    day: number;
}

/**
 * ApiClient - Singleton Tauri IPC client
 */
class ApiClient {
    private static instance: ApiClient | null = null;

    private constructor() {}

    static getInstance(): ApiClient {
        if (!ApiClient.instance) {
            ApiClient.instance = new ApiClient();
        }
        return ApiClient.instance;
    }

    // ==================== CONFIG ====================

    async getConfig(): Promise<AppConfig> {
        return invoke<AppConfig>('get_config');
    }

    // ==================== TILES ====================

    async calculateTileProperties(tiles: TileCenter[]): Promise<TileProperties[]> {
        return invoke<TileProperties[]>('calculate_tile_properties', { tiles });
    }

    // ==================== CALENDAR ====================

    async getCalendarState(): Promise<CalendarState> {
        return invoke<CalendarState>('get_calendar_state');
    }

    async startCalendar(speed?: string): Promise<CalendarState> {
        return invoke<CalendarState>('start_calendar', { speed });
    }

    async stopCalendar(): Promise<CalendarState> {
        return invoke<CalendarState>('stop_calendar');
    }

    async getCalendarSpeeds(): Promise<SpeedMode[]> {
        return invoke<SpeedMode[]>('get_calendar_speeds');
    }

    async setCalendarSpeed(speed: string): Promise<CalendarState> {
        return invoke<CalendarState>('set_calendar_speed', { speed });
    }

    // ==================== POPULATION ====================

    async getPopulation(): Promise<number> {
        return invoke<number>('get_population');
    }

    async getDemographics(): Promise<Demographics> {
        return invoke<Demographics>('get_demographics');
    }

    async getPopulationByTile(): Promise<TilePopulationData[]> {
        return invoke<TilePopulationData[]>('get_population_by_tile');
    }

    async getTilePopulation(tileId: number): Promise<number> {
        return invoke<number>('get_tile_population', { tileId });
    }

    // ==================== PEOPLE ====================

    async getAllPeople(): Promise<PersonData[]> {
        return invoke<PersonData[]>('get_all_people');
    }

    async getPerson(personId: number): Promise<PersonData | null> {
        return invoke<PersonData | null>('get_person', { personId });
    }

    async getPeopleByTile(tileId: number): Promise<PersonData[]> {
        return invoke<PersonData[]>('get_people_by_tile', { tileId });
    }

    // ==================== STATISTICS ====================

    async getVitalStatistics(startYear: number, endYear: number): Promise<VitalStatistics> {
        return invoke<VitalStatistics>('get_vital_statistics', { startYear, endYear });
    }

    async getCurrentYearStatistics(): Promise<VitalStatistics> {
        return invoke<VitalStatistics>('get_current_year_statistics');
    }

    async getRecentStatistics(years?: number): Promise<VitalStatistics> {
        return invoke<VitalStatistics>('get_recent_statistics', { years });
    }

    async getRecentEvents(count?: number): Promise<EventData[]> {
        return invoke<EventData[]>('get_recent_events', { count });
    }

    async getEventCount(): Promise<number> {
        return invoke<number>('get_event_count');
    }

    // ==================== WORLD ====================

    async tick(count?: number): Promise<TickEvent> {
        return invoke<TickEvent>('tick', { count });
    }

    async saveWorld(filePath: string): Promise<SaveResult> {
        return invoke<SaveResult>('save_world', { filePath });
    }

    async loadWorld(filePath: string): Promise<LoadResult> {
        return invoke<LoadResult>('load_world', { filePath });
    }

    async restartWorld(habitableTileIds: number[], newSeed?: number): Promise<RestartResult> {
        return invoke<RestartResult>('restart_world', { habitableTileIds, newSeed });
    }

    // ==================== MEMORY ====================

    async getMemoryUsage(): Promise<MemoryUsage> {
        return invoke<MemoryUsage>('get_memory_usage');
    }
}

// Export singleton getter for convenience
export const getApiClient = (): ApiClient => ApiClient.getInstance();
export default ApiClient;
