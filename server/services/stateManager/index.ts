/**
 * State Manager - Main Entry Point
 * Handles syncing state between Redis (hot data) and PostgreSQL (persistence)
 * 
 * This module has been refactored into:
 * - loadOperations/ - Loading state from PostgreSQL to Redis
 * - saveOperations.ts - Saving Redis state to PostgreSQL
 * - storageOperations.ts - Redis CRUD operations
 */

import storage from '../storage';
import { loadFromDatabase } from './loadOperations';
import { saveToDatabase } from './saveOperations';
import * as redisOps from './storageOperations';

interface LoadContext {
    calendarService?: any;
    io?: any;
}

interface LoadResult {
    villages: number;
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
     * Check if Redis is available
     */
    static isRedisAvailable(): boolean {
        return storage.isAvailable();
    }

    /**
     * Load all data from PostgreSQL into Redis on server start
     */
    static async loadFromDatabase(context?: LoadContext): Promise<LoadResult> {
        // Allow callers to pass a context with a calendarService & io for integration tests
        const calendarService = context && context.calendarService ? context.calendarService : this.calendarService;
        const io = context && context.io ? context.io : this.io;
        let paused = false;

        // Acquire a lock to prevent concurrent loads
        const { acquireLock, releaseLock } = require('../../utils/lock');
        const lockKey = 'state:load:lock';
        const token = await acquireLock(lockKey, 60000, 5000);
        if (!token) {
            console.warn('[StateManager] loadFromDatabase skipped: could not acquire load lock');
            return { villages: 0, people: 0, families: 0, skipped: true };
        }

        try {
            // Pause the calendar if it's currently running to avoid tick events during load
            if (calendarService && calendarService.state && calendarService.state.isRunning) {
                try {
                    calendarService.stop();
                    paused = true;
                } catch (e: unknown) {
                    // If we cannot pause the calendar, skip loading to avoid inconsistent state
                    console.warn('⚠️ Could not pause calendar, skipping state load');
                    return { villages: 0, people: 0, families: 0, skipped: true };
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
            // release lock
            try { await releaseLock(lockKey, token); } catch (e: unknown) { console.warn('[StateManager] Failed to release lock:', (e as Error)?.message ?? e); }
        }
    }

    /**
     * Check whether there are pending changes in Redis that require persisting to Postgres.
     * Returns true if any pending insert/update/delete sets are non-empty.
     */
    static async hasPendingChanges(): Promise<boolean> {
        if (!storage.isAvailable()) return false;
        const pendingSets = [
            'pending:person:inserts',
            'pending:person:updates',
            'pending:person:deletes',
            'pending:family:inserts',
            'pending:family:updates',
            'pending:family:deletes',
            'pending:village:inserts',
            'pending:tiles:regenerate'
        ];
        for (const key of pendingSets) {
            try {
                const count = await storage.scard(key);
                if (count && count > 0) return true;
            } catch (_: unknown) { /* ignore */ }
        }
        return false;
    }

    /**
     * Save all Redis state back to PostgreSQL (skips if no pending changes)
     */
    static async saveToDatabase(): Promise<any> {
        if (!this.isRedisAvailable()) {
            throw new Error('Redis is not available - cannot save in-memory state to database');
        }
        const hasPending = await this.hasPendingChanges();
        if (!hasPending) {
            console.log('[StateManager] No pending changes detected - proceeding with save flow for consistent results');
            // Intentionally continue to call saveToDatabase so callers/tests receive a consistent result object
        }
        return await saveToDatabase({
            calendarService: this.calendarService,
            io: this.io
        });
    }

    // Delegate Redis operations to redisOperations module
    static async getVillage(villageId: number | string): Promise<any> {
        return redisOps.getVillage(villageId);
    }

    static async updateVillage(villageId: number | string, updates: any): Promise<any> {
        return redisOps.updateVillage(villageId, updates);
    }

    static async getAllVillages(): Promise<any[]> {
        return redisOps.getAllVillages();
    }

    static async getPerson(personId: number | string): Promise<any> {
        return redisOps.getPerson(personId);
    }

    static async updatePerson(personId: number | string, updates: any): Promise<any> {
        return redisOps.updatePerson(personId, updates);
    }

    static async getPopulationCount(): Promise<number> {
        return redisOps.getPopulationCount();
    }

    static async getAllPeople(): Promise<any[]> {
        return redisOps.getAllPeople();
    }

    static async getVillagePopulation(tileId: string, chunkIndex: number): Promise<any> {
        return redisOps.getVillagePopulation(tileId, chunkIndex);
    }

    static async getTileFertility(tileId: string): Promise<any> {
        return redisOps.getTileFertility(tileId);
    }

    static async getVillageClearedLand(villageId: string): Promise<any> {
        return redisOps.getVillageClearedLand(villageId);
    }

    static async addPersonToStorage(person: any): Promise<any> {
        return redisOps.addPersonToStorage(person);
    }

    static async removePersonFromStorage(personId: number | string): Promise<any> {
        return redisOps.removePersonFromStorage(personId);
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
