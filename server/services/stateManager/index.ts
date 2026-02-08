/**
 * State Manager - Main Entry Point
 * Handles syncing state between Rust ECS and bincode file (persistence)
 *
 * This module has been refactored into:
 * - loadOperations/ - Loading state from bincode file to Rust ECS
 * - saveOperations.ts - Saving Rust ECS state to bincode file
 */

import { loadFromDatabase } from './loadOperations';
import { saveToDatabase } from './saveOperations';

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
     * Load all data from bincode file into Rust ECS
     */
    static async loadFromDatabase(context?: LoadContext): Promise<LoadResult> {
        const calendarService = context && context.calendarService ? context.calendarService : this.calendarService;
        const io = context && context.io ? context.io : this.io;
        let paused = false;

        try {
            // Pause the calendar if it's currently running to avoid tick events during load
            if (calendarService && calendarService.state && calendarService.state.isRunning) {
                try {
                    calendarService.stop();
                    paused = true;
                } catch (e: unknown) {
                    console.warn('Could not pause calendar, skipping state load');
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
     * Save all Rust ECS state to bincode file
     */
    static async saveToDatabase(): Promise<any> {
        return await saveToDatabase({
            calendarService: this.calendarService,
            io: this.io
        });
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
        this.initialized = false;
    }
}

export default StateManager;
