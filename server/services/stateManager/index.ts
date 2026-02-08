/**
 * State Manager - Main Entry Point
 * Handles syncing state between Rust ECS and bincode file (persistence)
 *
 * This module has been refactored into:
 * - loadOperations/ - Loading state from bincode file to Rust ECS
 * - saveOperations.ts - Saving Rust ECS state to bincode file
 * - storageOperations.ts - Storage operations (deprecated)
 */

import { loadFromDatabase } from './loadOperations';
import { saveToDatabase } from './saveOperations';
import * as redisOps from './storageOperations';

interface LoadContext {
    calendarService?: any;
    io?: any;
}

interface LoadResult {
    people: number;
    families: number;
    skipped?: boolean;
}

class StateManager {
    static io: any = null;
    static initialized: boolean = false;
    static calendarService: any = null;

    static setIo(io: any): void {
        this.io = io;
    }

    static setCalendarService(calendarService: any): void {
        this.calendarService = calendarService;
    }

    /**
     * Check if Redis is available (deprecated - always returns true as Rust ECS is always available)
     */
    static isRedisAvailable(): boolean {
        return true;
    }

    /**
     * Load all data from PostgreSQL into Redis on server start
     */
    static async loadFromDatabase(context?: LoadContext): Promise<LoadResult> {
        // Allow callers to pass a context with a calendarService & io for integration tests
        const calendarService = context && context.calendarService ? context.calendarService : this.calendarService;
        const io = context && context.io ? context.io : this.io;
        let paused = false;

        // Locking removed - Rust ECS handles concurrency with internal Mutex
        // Redis-based distributed locks no longer needed

        try {
            // Pause the calendar if it's currently running to avoid tick events during load
            if (calendarService && calendarService.state && calendarService.state.isRunning) {
                try {
                    calendarService.stop();
                    paused = true;
                } catch (e: unknown) {
                    // If we cannot pause the calendar, skip loading to avoid inconsistent state
                    console.warn('⚠️ Could not pause calendar, skipping state load');
                    return { people: 0, families: 0, skipped: true };
                }
            }

            const result = await loadFromDatabase({
                calendarService: calendarService,
                io: io
            });
            if (!result.skipped) {
                this.initialized = true;
            }
            return result;
        } finally {
            // Resume the calendar if we paused it
            if (paused && calendarService && typeof calendarService.start === 'function') {
                try {
                    calendarService.start();
                } catch (e: unknown) { /* ignore */ }
            }
        }
    }

    /**
     * Check whether there are pending changes (deprecated - Rust ECS handles all state)
     */
    static async hasPendingChanges(): Promise<boolean> {
        return false;
    }

    /**
     * Save all Rust ECS state to bincode file
     */
    static async saveToDatabase(): Promise<any> {
        return await saveToDatabase({
            calendarService: this.calendarService,
            io: this.io
        });
    }

    // Person data removed - all managed by Rust ECS
    // Use rustSimulation directly for person data
    static async getPerson(_personId: number | string): Promise<any> {
        throw new Error('getPerson deprecated - use rustSimulation directly');
    }

    static async updatePerson(_personId: number | string, _updates: any): Promise<any> {
        throw new Error('updatePerson deprecated - use rustSimulation directly');
    }

    static async getPopulationCount(): Promise<number> {
        // Return 0 for now - Rust ECS is source of truth
        return 0;
    }

    static async getAllPeople(): Promise<any[]> {
        throw new Error('getAllPeople deprecated - use rustSimulation directly');
    }

    static async getTileFertility(tileId: string): Promise<any> {
        return redisOps.getTileFertility(tileId);
    }

    static async addPersonToStorage(_person: any): Promise<any> {
        throw new Error('addPersonToStorage deprecated - use rustSimulation directly');
    }

    static async removePersonFromStorage(_personId: number | string): Promise<any> {
        throw new Error('removePersonFromStorage deprecated - use rustSimulation directly');
    }

    /**
     * Check if storage state is initialized
     */
    static isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Clear all storage state (useful for testing)
     */
    static async clearStorage(): Promise<void> {
        await redisOps.clearStorage();
        this.initialized = false;
    }
}

export default StateManager;
