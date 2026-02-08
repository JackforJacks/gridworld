// Rust Simulation Service - manages the native hecs/napi-rs simulation

// eslint-disable-next-line @typescript-eslint/no-var-requires
const simulation = require('../../simulation/index.js');

export interface RustCalendar {
    day: number;
    month: number;
    year: number;
}

export interface TickResult {
    births: number;
    deaths: number;
    marriages: number;
    pregnancies: number;
    dissolutions: number;
    population: number;
}

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

export interface Event {
    eventType: string; // 'birth' | 'death' | 'marriage' | 'pregnancy_started' | 'dissolution'
    year: number;
    month: number;
    day: number;
    personId?: number;
}

export interface TilePopulation {
    tileId: number;
    count: number;
}

export interface Demographics {
    population: number;
    males: number;
    females: number;
    partnered: number;
    single: number;
    pregnant: number;
    averageAge: number;
    age0_4: number;
    age5_14: number;
    age15_29: number;
    age30_49: number;
    age50_69: number;
    age70_89: number;
    age90Plus: number;
}

export interface ImportResult {
    population: number;
    partners: number;
    mothers: number;
    calendarYear: number;
}

export interface SaveFileStats {
    population: number;
    fileBytes: number;
}

export interface LoadFileResult {
    population: number;
    partners: number;
    mothers: number;
    calendarYear: number;
    seed: number;
    nodeStateJson: string;
}

class RustSimulationService {
    private world: unknown = null;

    constructor() {
        this.world = simulation.createWorld();
        console.log('🦀 Rust simulation world created');
    }

    /** Seed population on a specific tile */
    seedPopulationOnTile(count: number, tileId: number): void {
        simulation.seedPopulationOnTile(this.world, count, tileId);
    }

    /** Seed population on a tile with a random count within [min, max]. Returns actual count seeded. */
    seedPopulationOnTileRange(min: number, max: number, tileId: number): number {
        return simulation.seedPopulationOnTileRange(this.world, min, max, tileId) as number;
    }

    /** Seed population (tile 0) */
    seedPopulation(count: number): void {
        simulation.seedPopulation(this.world, count);
    }

    /** Advance simulation by one tick (1 day). Returns births/deaths/marriages/population. */
    tick(): TickResult {
        return simulation.tick(this.world) as TickResult;
    }

    /** Advance simulation by N ticks. Returns accumulated births/deaths/marriages + final population. */
    tickMany(count: number): TickResult {
        return simulation.tickMany(this.world, count) as TickResult;
    }

    /** Get total population (entity count) */
    getPopulation(): number {
        return simulation.getEntityCount(this.world);
    }

    /** Get process memory usage in bytes */
    getMemoryBytes(): number {
        return simulation.getMemoryBytes(this.world);
    }

    /** Get current simulation calendar */
    getCalendar(): RustCalendar {
        return simulation.getCalendar(this.world);
    }

    /** Get current day (total days since year 4000) */
    getCurrentDay(): number {
        return simulation.getCurrentDay(this.world);
    }

    // ========================================================================
    // Statistics queries (Phase 2)
    // ========================================================================

    /** Get population count for a specific tile */
    getTilePopulation(tileId: number): number {
        return simulation.getTilePopulation(this.world, tileId) as number;
    }

    /** Get population counts per tile */
    getPopulationByTile(): TilePopulation[] {
        const raw = simulation.getPopulationByTile(this.world) as Array<{ tileId: number; count: number }>;
        return raw.map((r: { tileId: number; count: number }) => ({ tileId: r.tileId, count: r.count }));
    }

    /** Get full demographics snapshot (age distribution, sex ratio, partnership stats) */
    getDemographics(): Demographics {
        const d = simulation.getDemographics(this.world);
        // napi-rs converts snake_case to camelCase: age_0_4 → age04, age_5_14 → age514, etc.
        return {
            population: d.population,
            males: d.males,
            females: d.females,
            partnered: d.partnered,
            single: d.single,
            pregnant: d.pregnant,
            averageAge: d.averageAge,
            age0_4: d.age04,
            age5_14: d.age514,
            age15_29: d.age1529,
            age30_49: d.age3049,
            age50_69: d.age5069,
            age70_89: d.age7089,
            age90Plus: d.age90Plus,
        };
    }

    /** Reset world - creates new world instance */
    reset(): void {
        this.world = simulation.createWorld();
        console.log('🦀 Rust simulation world reset');
    }

    // ========================================================================
    // Persistence (Phase 4)
    // ========================================================================

    /** Export entire world state to JSON string for database storage */
    exportWorld(): string {
        const json = simulation.exportWorld(this.world) as string;
        console.log(`🦀 Exported Rust world: ${json.length} bytes`);
        return json;
    }

    /** Import world state from JSON string, replacing current state */
    importWorld(json: string): ImportResult {
        const result = simulation.importWorld(this.world, json) as ImportResult;
        console.log(`🦀 Imported Rust world: ${result.population} people, ${result.partners} partners, year ${result.calendarYear}`);
        return result;
    }

    // ========================================================================
    // File-based persistence (bincode)
    // ========================================================================

    /** Save world + Node state to a bincode file */
    saveToFile(nodeStateJson: string, seed: number, filePath: string): SaveFileStats {
        const result = simulation.saveToFile(this.world, nodeStateJson, seed, filePath) as SaveFileStats;
        console.log(`🦀 Saved to ${filePath}: ${result.population} people, ${result.fileBytes} bytes`);
        return result;
    }

    /** Load world + Node state from a bincode file */
    loadFromFile(filePath: string): LoadFileResult {
        const result = simulation.loadFromFile(this.world, filePath) as LoadFileResult;
        console.log(`🦀 Loaded from ${filePath}: ${result.population} people, year ${result.calendarYear}`);
        return result;
    }

    // ========================================================================
    // ID Allocation (replaces Redis idAllocator)
    // ========================================================================

    /** Get next person ID (increments Rust counter atomically) */
    getNextPersonId(): number {
        return simulation.getNextPersonId(this.world) as number;
    }

    /** Get a batch of person IDs (more efficient than repeated calls) */
    getPersonIdBatch(count: number): number[] {
        return simulation.getPersonIdBatch(this.world, count) as number[];
    }

    // ========================================================================
    // Calendar Auto-Ticking (Phase 1 - Rust-controlled timer)
    // ========================================================================

    /**
     * Start calendar auto-ticking in a Rust background thread
     * @param intervalMs - Milliseconds between ticks (1000 = daily, 125 = monthly)
     * @param callback - Function called on each tick with tick results
     */
    startCalendar(intervalMs: number, callback: (event: TickEvent) => void): void {
        simulation.startCalendar(this.world, intervalMs, callback);
        console.log(`🦀 Rust calendar started (${intervalMs}ms intervals)`);
    }

    /**
     * Stop calendar auto-ticking
     */
    stopCalendar(): void {
        simulation.stopCalendar();
        console.log('🦀 Rust calendar stopped');
    }

    /**
     * Check if calendar is currently running
     */
    isCalendarRunning(): boolean {
        return simulation.isCalendarRunning() as boolean;
    }

    // ========================================================================
    // Event Log Queries (Phase 2 - event history)
    // ========================================================================

    /**
     * Get all events from event log (newest first)
     */
    getAllEvents(): Event[] {
        return simulation.getAllEvents(this.world) as Event[];
    }

    /**
     * Get recent events (last N events, newest first)
     */
    getRecentEvents(count: number): Event[] {
        return simulation.getRecentEvents(this.world, count) as Event[];
    }

    /**
     * Get events filtered by type
     * @param eventType - 'birth' | 'death' | 'marriage' | 'pregnancy_started' | 'dissolution'
     */
    getEventsByType(eventType: string): Event[] {
        return simulation.getEventsByType(this.world, eventType) as Event[];
    }

    /**
     * Get events within a date range (inclusive)
     */
    getEventsByDateRange(startYear: number, endYear: number): Event[] {
        return simulation.getEventsByDateRange(this.world, startYear, endYear) as Event[];
    }

    /**
     * Count events by type within a date range
     */
    countEventsByType(eventType: string, startYear: number, endYear: number): number {
        return simulation.countEventsByType(this.world, eventType, startYear, endYear) as number;
    }

    /**
     * Get total event count in log
     */
    getEventCount(): number {
        return simulation.getEventCount(this.world) as number;
    }

    /**
     * Clear event log
     */
    clearEventLog(): void {
        simulation.clearEventLog(this.world);
    }

    // ========================================================================
    // Vital Statistics (Phase 3)
    // ========================================================================

    /**
     * Calculate vital statistics for a date range (inclusive)
     * @param startYear - Start year
     * @param endYear - End year
     * @returns Vital statistics including birth rate, death rate, marriage rate per 1000 population per year
     */
    calculateVitalStatistics(startYear: number, endYear: number): VitalStatistics {
        return simulation.calculateVitalStatistics(this.world, startYear, endYear) as VitalStatistics;
    }

    /**
     * Calculate vital statistics for the current year only
     * @returns Vital statistics for current year
     */
    calculateCurrentYearStatistics(): VitalStatistics {
        return simulation.calculateCurrentYearStatistics(this.world) as VitalStatistics;
    }

    /**
     * Calculate vital statistics for the last N years
     * @param years - Number of years to look back
     * @returns Vital statistics for the specified period
     */
    calculateRecentStatistics(years: number): VitalStatistics {
        return simulation.calculateRecentStatistics(this.world, years) as VitalStatistics;
    }

    // ========================================================================
    // Person Queries (Phase 5)
    // ========================================================================

    /**
     * Get all people from Rust ECS
     * @returns Array of all people in the simulation
     */
    getAllPeople(): Person[] {
        return simulation.getAllPeople(this.world) as Person[];
    }

    /**
     * Get a specific person by ID
     * @param personId - Person ID to fetch
     * @returns Person data or null if not found
     */
    getPerson(personId: number): Person | null {
        return simulation.getPerson(this.world, personId) as Person | null;
    }

    /**
     * Get all people on a specific tile
     * @param tileId - Tile ID to query
     * @returns Array of people on the tile
     */
    getPeopleByTile(tileId: number): Person[] {
        return simulation.getPeopleByTile(this.world, tileId) as Person[];
    }
}

// VitalStatistics interface
export interface VitalStatistics {
    birthRate: number;
    deathRate: number;
    marriageRate: number;
    naturalIncreaseRate: number;
    totalBirths: number;
    totalDeaths: number;
    totalMarriages: number;
    population: number;
    periodYears: number;
}

// Person interface (Phase 5 - from Rust ECS)
export interface Person {
    id: number;
    firstName: string;
    lastName: string;
    tileId: number;
    sex: boolean; // true = male, false = female
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    ageYears: number;
    isPartnered: boolean;
    isPregnant: boolean;
    partnerId: number | null;
}

// Export singleton instance
const rustSimulation = new RustSimulationService();
export default rustSimulation;
