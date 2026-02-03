/**
 * ApiClient - Centralized HTTP API service
 * 
 * Provides a single place for all REST API calls.
 * Handles error handling, response parsing, and base URL configuration.
 */

/** Standard API response wrapper */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

/** Calendar state from API */
export interface CalendarState {
    year: number;
    month: number;
    day: number;
    isRunning: boolean;
    totalDays: number;
    totalTicks: number;
    startTime: string | null;
    lastTickTime: string | null;
    config: {
        daysPerMonth?: number;
        monthsPerYear?: number;
        tickIntervalMs?: number;
    };
    formatted: {
        short?: string;
        long?: string;
        iso?: string;
    };
}

/** Speed mode configuration */
export interface SpeedMode {
    name: string;
    intervalMs: number;
}

/** Calendar statistics */
export interface CalendarStats {
    totalTicks: number;
    totalDays: number;
    uptime: number;
    averageTickRate: number;
}

/** Hexasphere configuration */
export interface HexasphereConfig {
    radius: number;
    subdivisions: number;
    tileWidthRatio: number;
}

/** Server configuration */
export interface ServerConfig {
    hexasphere: HexasphereConfig;
    [key: string]: unknown;
}

/** Tile data from API */
export interface TileData {
    id: number | string;
    boundary: Array<{ x: number; y: number; z: number }>;
    centerPoint: { x: number; y: number; z: number };
    terrainType: string;
    isLand: boolean;
    biome: string;
    Habitable: string;
}

/** Tiles API response */
export interface TilesResponse {
    tiles: TileData[];
    count: number;
}

/** Compact tile state for a single tile (from /api/tile-state) */
export interface CompactTileState {
    t: string;      // terrainType
    l: boolean;     // isLand
    b: string | null; // biome
    h: boolean;     // Habitable
}

/** Tile state API response (no geometry, just state) */
export interface TileStateResponse {
    count: number;
    state: Record<string, CompactTileState>;
}

/** Population data */
export interface PopulationData {
    globalData: {
        lastUpdated: number;
        growth: {
            rate: number;
            interval: number;
        };
    };
    tilePopulations: Record<string, number>;
    totalPopulation: number;
}

/** Statistics data */
export interface StatisticsData {
    totalPopulation?: number;
    male?: number;
    female?: number;
    minors?: number;
    working_age?: number;
    elderly?: number;
    bachelors?: number;
    birthRate?: number;
    deathRate?: number;
    birthCount?: number;
    deathCount?: number;
    totalBirthCount?: number;
    totalDeathCount?: number;
    totalFamilies?: number;
    pregnantFamilies?: number;
    familiesWithChildren?: number;
    avgChildrenPerFamily?: number;
    villagesCount?: number;
}

/** Vital rates data point */
export interface VitalRatePoint {
    year: number;
    birthRate: number;
    deathRate: number;
}

/** Memory usage statistics from server */
export interface MemoryStats {
    /** Resident Set Size - total memory allocated for the process */
    rss: number;
    /** Total size of the allocated heap */
    heapTotal: number;
    /** Actual memory used during execution */
    heapUsed: number;
    /** V8 external memory (C++ objects bound to JS) */
    external: number;
    /** Memory used by ArrayBuffers and SharedArrayBuffers */
    arrayBuffers: number;
    /** Formatted human-readable values */
    formatted: {
        rss: string;
        heapTotal: string;
        heapUsed: string;
        external: string;
        arrayBuffers: string;
    };
    /** Heap usage percentage */
    heapUsagePercent: number;
    /** Timestamp of the measurement */
    timestamp: number;
    /** Uptime in seconds */
    uptimeSeconds: number;
}

/** Memory history response */
export interface MemoryHistory {
    current: MemoryStats;
    peak: {
        heapUsed: number;
        heapUsedFormatted: string;
        rss: number;
        rssFormatted: string;
        timestamp: number;
    };
    samples: MemoryStats[];
    sampleCount: number;
    averageHeapUsed: number;
    averageHeapUsedFormatted: string;
}

/**
 * ApiClient - Singleton HTTP client
 */
class ApiClient {
    private static instance: ApiClient | null = null;
    private baseUrl: string;

    private constructor(baseUrl: string = '') {
        this.baseUrl = baseUrl;
    }

    /**
     * Get singleton instance
     */
    static getInstance(): ApiClient {
        if (!ApiClient.instance) {
            ApiClient.instance = new ApiClient();
        }
        return ApiClient.instance;
    }

    /**
     * Set base URL (useful for testing or different environments)
     */
    setBaseUrl(url: string): void {
        this.baseUrl = url;
    }

    /**
     * Generic fetch wrapper with error handling
     */
    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`API request failed: ${endpoint}`, error);
            throw error;
        }
    }

    // ==================== CONFIG ====================

    /**
     * Get server configuration
     */
    async getConfig(): Promise<ServerConfig> {
        return this.request<ServerConfig>('/api/config');
    }

    // ==================== TILES ====================

    /**
     * Get all tiles (minimal data for rendering)
     * @deprecated Use getTileState() + client-side geometry generation instead
     */
    async getTiles(
        radius: number,
        subdivisions: number,
        tileWidthRatio: number,
        forceRegenerate: boolean = false
    ): Promise<TilesResponse> {
        const regenQuery = forceRegenerate ? '&regenerate=true' : '';
        return this.request<TilesResponse>(
            `/api/tiles?radius=${radius}&subdivisions=${subdivisions}&tileWidthRatio=${tileWidthRatio}${regenQuery}`
        );
    }

    /**
     * Get tile state only (no geometry) - for client-side hexasphere generation
     * Returns compact state keyed by tile ID: { t: terrainType, l: isLand, b: biome, h: habitable }
     */
    async getTileState(): Promise<TileStateResponse> {
        return this.request<TileStateResponse>('/api/tiles/state');
    }

    /**
     * Get detailed tile data by ID
     */
    async getTileById(tileId: number | string): Promise<TileData> {
        return this.request<TileData>(`/api/tiles/${tileId}`);
    }

    // ==================== CALENDAR ====================

    /**
     * Get current calendar state
     */
    async getCalendarState(): Promise<ApiResponse<CalendarState>> {
        return this.request<ApiResponse<CalendarState>>('/api/calendar/state');
    }

    /**
     * Start the calendar
     */
    async startCalendar(): Promise<ApiResponse<CalendarState>> {
        return this.request<ApiResponse<CalendarState>>('/api/calendar/start', { method: 'POST' });
    }

    /**
     * Stop the calendar
     */
    async stopCalendar(): Promise<ApiResponse<CalendarState>> {
        return this.request<ApiResponse<CalendarState>>('/api/calendar/stop', { method: 'POST' });
    }

    /**
     * Reset the calendar
     */
    async resetCalendar(): Promise<ApiResponse<CalendarState>> {
        return this.request<ApiResponse<CalendarState>>('/api/calendar/reset', { method: 'POST' });
    }

    /**
     * Set calendar date
     */
    async setCalendarDate(year: number, month: number, day: number): Promise<ApiResponse<CalendarState>> {
        return this.request<ApiResponse<CalendarState>>('/api/calendar/date', {
            method: 'POST',
            body: JSON.stringify({ year, month, day })
        });
    }

    /**
     * Set calendar tick interval
     */
    async setCalendarInterval(intervalMs: number): Promise<ApiResponse<CalendarState>> {
        return this.request<ApiResponse<CalendarState>>('/api/calendar/interval', {
            method: 'POST',
            body: JSON.stringify({ interval: intervalMs })
        });
    }

    /**
     * Get available speed modes
     */
    async getCalendarSpeeds(): Promise<SpeedMode[]> {
        return this.request<SpeedMode[]>('/api/calendar/speeds');
    }

    /**
     * Set calendar speed by name
     */
    async setCalendarSpeed(speedName: string): Promise<ApiResponse<CalendarState>> {
        return this.request<ApiResponse<CalendarState>>('/api/calendar/speed', {
            method: 'POST',
            body: JSON.stringify({ speed: speedName })
        });
    }

    /**
     * Get calendar statistics
     */
    async getCalendarStats(): Promise<CalendarStats> {
        return this.request<CalendarStats>('/api/calendar/stats');
    }

    // ==================== POPULATION ====================

    /**
     * Get population data
     */
    async getPopulation(): Promise<PopulationData> {
        return this.request<PopulationData>('/api/population');
    }

    /**
     * Initialize population
     */
    async initializePopulation(): Promise<ApiResponse> {
        return this.request<ApiResponse>('/api/population/initialize', { method: 'POST' });
    }

    // ==================== STATISTICS ====================

    /**
     * Get current statistics
     */
    async getCurrentStatistics(): Promise<StatisticsData> {
        return this.request<StatisticsData>('/api/statistics/current');
    }

    /**
     * Get dashboard statistics
     */
    async getDashboardStatistics(years: number = 100): Promise<unknown> {
        return this.request<unknown>(`/api/statistics/dashboard?years=${years}`);
    }

    /**
     * Get vital rates history
     */
    async getVitalRates(years: number = 100): Promise<VitalRatePoint[]> {
        return this.request<VitalRatePoint[]>(`/api/statistics/vital-rates/${years}`);
    }

    // ==================== WORLD ====================

    /**
     * Restart the world (regenerate everything)
     */
    async worldRestart(): Promise<ApiResponse> {
        return this.request<ApiResponse>('/api/worldrestart', { method: 'POST' });
    }

    /**
     * Save game state
     */
    async saveGame(): Promise<ApiResponse> {
        return this.request<ApiResponse>('/api/save', { method: 'POST' });
    }

    /**
     * Sync game state
     */
    async syncGame(): Promise<ApiResponse> {
        return this.request<ApiResponse>('/api/sync', { method: 'POST' });
    }

    // ==================== SYSTEM ====================

    /**
     * Get current memory usage statistics
     */
    async getMemoryStats(): Promise<ApiResponse<MemoryStats>> {
        return this.request<ApiResponse<MemoryStats>>('/api/system/memory');
    }

    /**
     * Get memory usage history
     */
    async getMemoryHistory(): Promise<ApiResponse<MemoryHistory>> {
        return this.request<ApiResponse<MemoryHistory>>('/api/system/memory/history');
    }

    /**
     * Get system health status
     */
    async getSystemHealth(): Promise<ApiResponse> {
        return this.request<ApiResponse>('/api/system/health');
    }
}

// Export singleton getter for convenience
export const getApiClient = (): ApiClient => ApiClient.getInstance();
export default ApiClient;
