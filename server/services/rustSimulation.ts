// Rust Simulation Service - manages the native hecs/napi-rs simulation

// eslint-disable-next-line @typescript-eslint/no-var-requires
const simulation = require('../../simulation/index.js');

export interface RustCalendar {
    day: number;
    month: number;
    year: number;
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

    /** Seed population (tile 0) */
    seedPopulation(count: number): void {
        simulation.seedPopulation(this.world, count);
    }

    /** Advance simulation by one tick (1 day) */
    tick(): void {
        simulation.tick(this.world);
    }

    /** Advance simulation by N ticks */
    tickMany(count: number): void {
        simulation.tickMany(this.world, count);
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

    /** Reset world - creates new world instance */
    reset(): void {
        this.world = simulation.createWorld();
        console.log('🦀 Rust simulation world reset');
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
