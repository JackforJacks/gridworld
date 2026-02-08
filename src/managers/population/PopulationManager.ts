// Population Manager - Handles real-time population data updates via Tauri IPC
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { TickEvent, TilePopulationData } from '../../services/api/ApiClient';

/** Rust ECS tick data from calendar-tick event */
export interface RustTickData {
    births: number;
    deaths: number;
    marriages: number;
    pregnancies: number;
    dissolutions: number;
    population: number;
}

/** Tile population mapping (tileId -> population count) */
interface TilePopulations {
    [tileId: string]: number;
}

/** Population update callback function type */
type PopulationCallback = (eventType: string, data: unknown) => void;

class PopulationManager {
    private callbacks: Set<PopulationCallback>;
    private tilePopulations: TilePopulations;
    private totalPopulation: number;
    private rustTickData: RustTickData;
    private unlistenTick: UnlistenFn | null;

    constructor() {
        this.callbacks = new Set();
        this.tilePopulations = {};
        this.totalPopulation = 0;
        this.rustTickData = {
            births: 0,
            deaths: 0,
            marriages: 0,
            pregnancies: 0,
            dissolutions: 0,
            population: 0
        };
        this.unlistenTick = null;
    }

    /**
     * Initialize: fetch initial population and setup tick listener
     */
    async connect(): Promise<void> {
        try {
            // Fetch initial population count
            const population = await invoke<number>('get_population');
            this.rustTickData.population = population;
            this.totalPopulation = population;
            this.notifyCallbacks('rustPopulation', this.rustTickData);

            // Fetch initial tile populations
            await this.refreshTilePopulations();

            // Listen for calendar-tick events (real-time population updates)
            this.unlistenTick = await listen<TickEvent>('calendar-tick', (event) => {
                const tick = event.payload;
                this.rustTickData = {
                    births: tick.births,
                    deaths: tick.deaths,
                    marriages: tick.marriages,
                    pregnancies: tick.pregnancies,
                    dissolutions: tick.dissolutions,
                    population: tick.population,
                };
                this.totalPopulation = tick.population;
                this.notifyCallbacks('rustPopulation', this.rustTickData);
            });

            this.notifyCallbacks('connected', true);
        } catch (error: unknown) {
            console.error('Failed to initialize population manager:', error);
        }
    }

    /**
     * Refresh tile population data from Rust
     */
    async refreshTilePopulations(): Promise<void> {
        try {
            const tileData = await invoke<TilePopulationData[]>('get_population_by_tile');
            this.tilePopulations = {};
            for (const entry of tileData) {
                this.tilePopulations[String(entry.tile_id)] = entry.count;
            }
            this.notifyCallbacks('populationUpdate', {
                tilePopulations: this.tilePopulations,
                totalPopulation: this.totalPopulation,
            });
        } catch (error: unknown) {
            console.error('Failed to fetch tile populations:', error);
        }
    }

    /**
     * Check if population data already exists
     */
    async hasExistingPopulation(): Promise<boolean> {
        try {
            const population = await invoke<number>('get_population');
            return population > 0;
        } catch {
            return false;
        }
    }

    /**
     * Disconnect: remove event listeners
     */
    disconnect(): void {
        if (this.unlistenTick) {
            this.unlistenTick();
            this.unlistenTick = null;
        }
    }

    // Get current Rust ECS tick data (real-time stats)
    getRustTickData(): RustTickData {
        return { ...this.rustTickData };
    }

    // Get all tile populations
    getAllTilePopulations(): TilePopulations {
        return this.tilePopulations;
    }

    // Get total population across all tiles
    getTotalPopulation(): number {
        return this.totalPopulation;
    }

    // Get population for a specific tile
    getTilePopulation(tileId: string): number {
        return this.tilePopulations[tileId] || 0;
    }

    // Get formatted total population count
    getFormattedCount(): string {
        return this.totalPopulation.toLocaleString();
    }

    // Subscribe to population updates
    subscribe(callback: PopulationCallback): () => void {
        if (typeof callback === 'function') {
            this.callbacks.add(callback);
        }
        return () => {
            this.callbacks.delete(callback);
        };
    }

    // Notify all subscribers
    notifyCallbacks(eventType: string, data: unknown): void {
        this.callbacks.forEach(callback => {
            try {
                callback(eventType, data);
            } catch (error: unknown) {
                console.error('Error in population callback:', error);
            }
        });
    }
}

// Create and export singleton instance
const populationManager = new PopulationManager();
export default populationManager;
