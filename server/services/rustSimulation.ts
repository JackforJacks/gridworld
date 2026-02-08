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

    /** Sync Rust ECS from Redis person data (used on server restart) */
    async syncFromRedis(): Promise<number> {
        const storage = require('./storage').default;
        
        // Get all people from Redis
        const allPeople = await storage.hgetall('person');
        if (!allPeople || Object.keys(allPeople).length === 0) {
            console.log('🦀 No people in Redis, Rust world stays empty');
            return 0;
        }

        // Group by tile_id
        const peoplByTile = new Map<number, number>();
        for (const personJson of Object.values(allPeople)) {
            const person = JSON.parse(personJson as string);
            const tileId = person.tile_id ?? 0;
            peoplByTile.set(tileId, (peoplByTile.get(tileId) || 0) + 1);
        }

        // Reset and re-seed
        this.reset();
        for (const [tileId, count] of peoplByTile) {
            this.seedPopulationOnTile(count, tileId);
        }

        const total = this.getPopulation();
        console.log(`🦀 Rust ECS synced from Redis: ${total} people across ${peoplByTile.size} tiles`);
        return total;
    }
}

// Export singleton instance
const rustSimulation = new RustSimulationService();
export default rustSimulation;
