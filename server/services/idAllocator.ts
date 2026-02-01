/**
 * ID Allocator - Redis-first ID allocation
 * 
 * Uses Redis atomic counters for ID allocation. No Postgres calls during runtime.
 * IDs are synced with Postgres only during explicit save/load operations.
 */

import storage from './storage';
import serverConfig from '../config/server';

interface PoolInfo {
    /** Redis key for the counter */
    redisKey: string;
    /** Postgres sequence name (for save/load sync) */
    sequence: string;
    /** Local cache of the current counter value */
    localNext: number;
    /** Local cache upper bound (for batch pre-fetching) */
    localMax: number;
}

interface Pools {
    people: PoolInfo;
    family: PoolInfo;
    villages: PoolInfo;
    [key: string]: PoolInfo;
}

class IdAllocator {
    pools: Pools;
    defaultBlockSize: number;
    // Mutex promises to prevent concurrent refills for the same entity type
    private refillLocks: Map<string, Promise<void>>;
    private initialized: boolean;

    constructor() {
        // ID pools for each entity type
        this.pools = {
            people: { redisKey: 'id:seq:people', sequence: 'people_id_seq', localNext: 0, localMax: 0 },
            family: { redisKey: 'id:seq:family', sequence: 'family_id_seq', localNext: 0, localMax: 0 },
            villages: { redisKey: 'id:seq:villages', sequence: 'villages_id_seq', localNext: 0, localMax: 0 }
        };
        this.defaultBlockSize = 1000;
        this.refillLocks = new Map();
        this.initialized = false;
    }

    /**
     * Initialize counters from Redis (called on startup after Redis is ready)
     * If Redis counters don't exist, they start at 1
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        if (!storage.isAvailable()) {
            console.warn('[IdAllocator] Redis not available, using local counters only');
            // Initialize local counters to 1
            for (const key of Object.keys(this.pools)) {
                this.pools[key].localNext = 1;
                this.pools[key].localMax = 1;
            }
            this.initialized = true;
            return;
        }

        for (const [entityType, poolInfo] of Object.entries(this.pools)) {
            try {
                const current = await storage.get(poolInfo.redisKey);
                if (current !== null) {
                    poolInfo.localNext = parseInt(current, 10) + 1;
                    poolInfo.localMax = poolInfo.localNext;
                    if (serverConfig.verboseLogs) {
                        console.log(`🔢 [IdAllocator] ${entityType} counter initialized at ${poolInfo.localNext}`);
                    }
                } else {
                    // Counter doesn't exist, start at 1
                    poolInfo.localNext = 1;
                    poolInfo.localMax = 1;
                    if (serverConfig.verboseLogs) {
                        console.log(`🔢 [IdAllocator] ${entityType} counter starting fresh at 1`);
                    }
                }
            } catch (err) {
                console.warn(`[IdAllocator] Failed to read ${entityType} counter:`, err);
                poolInfo.localNext = 1;
                poolInfo.localMax = 1;
            }
        }

        this.initialized = true;
    }

    /**
     * Reserve a block of IDs from Redis atomically
     * @param entityType - 'people', 'family', or 'villages'
     * @param count - Number of IDs needed
     */
    async refillPool(entityType: string, count: number): Promise<void> {
        const poolInfo = this.pools[entityType];
        if (!poolInfo) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        // Check if another refill is in progress for this entity type
        const existingLock = this.refillLocks.get(entityType);
        if (existingLock) {
            // Wait for the existing refill to complete
            await existingLock;
            // After waiting, check if pool now has IDs (the other refill succeeded)
            if (poolInfo.localNext < poolInfo.localMax) {
                return;
            }
        }

        // Create a new lock promise
        let resolveLock: () => void;
        const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
        this.refillLocks.set(entityType, lockPromise);

        const blockSize = Math.max(this.defaultBlockSize, count);

        try {
            if (!storage.isAvailable()) {
                // Fallback: use local counter only (no persistence)
                const firstId = poolInfo.localMax;
                poolInfo.localNext = firstId;
                poolInfo.localMax = firstId + blockSize;
                if (serverConfig.verboseLogs) {
                    console.log(`🔢 [IdAllocator] Reserved ${blockSize} ${entityType} IDs locally: ${firstId} - ${poolInfo.localMax - 1}`);
                }
                return;
            }

            // Use Redis INCRBY to atomically reserve a block of IDs
            // INCRBY returns the new value after increment
            const newMax = await storage.incrby(poolInfo.redisKey, blockSize);
            const firstId = newMax - blockSize + 1;

            poolInfo.localNext = firstId;
            poolInfo.localMax = newMax + 1; // +1 because localMax is exclusive

            if (serverConfig.verboseLogs) {
                console.log(`🔢 [IdAllocator] Reserved ${blockSize} ${entityType} IDs from Redis: ${firstId} - ${newMax}`);
            }
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            console.error(`[IdAllocator] Failed to reserve ${entityType} IDs:`, error.message);

            // Fallback: use local counter
            const firstId = poolInfo.localMax > 0 ? poolInfo.localMax : 1;
            poolInfo.localNext = firstId;
            poolInfo.localMax = firstId + blockSize;
            console.warn(`[IdAllocator] Using local fallback for ${entityType}: ${firstId} - ${poolInfo.localMax - 1}`);
        } finally {
            // Release the lock
            this.refillLocks.delete(entityType);
            resolveLock!();
        }
    }

    /**
     * Get the next available ID for an entity type
     * @param entityType - 'people', 'family', or 'villages'
     */
    async getNextId(entityType: string): Promise<number> {
        // Ensure initialized
        if (!this.initialized) {
            await this.initialize();
        }

        const poolInfo = this.pools[entityType];
        if (!poolInfo) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        // Refill if pool is empty
        if (poolInfo.localNext >= poolInfo.localMax) {
            await this.refillPool(entityType, 1);
        }

        return poolInfo.localNext++;
    }

    /**
     * Get a batch of IDs for an entity type
     * @param entityType - 'people', 'family', or 'villages'
     * @param count - Number of IDs needed
     */
    async getIdBatch(entityType: string, count: number): Promise<number[]> {
        // Ensure initialized
        if (!this.initialized) {
            await this.initialize();
        }

        const poolInfo = this.pools[entityType];
        if (!poolInfo) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        // Check if we have enough IDs in the pool
        const available = poolInfo.localMax - poolInfo.localNext;
        if (available < count) {
            await this.refillPool(entityType, count);
        }

        // Allocate the IDs
        const firstId = poolInfo.localNext;
        poolInfo.localNext += count;

        // Use Uint32Array internally for memory efficiency (4 bytes per ID vs 8)
        const idsTyped = new Uint32Array(count);
        for (let i = 0; i < count; i++) {
            idsTyped[i] = firstId + i;
        }
        // Return a plain Array for callers/tests for compatibility
        return Array.from(idsTyped);
    }

    /**
     * Sync counters from existing data after a load operation
     * Called by StateManager after loading data from Postgres
     * @param maxPeopleId - Maximum people ID found in loaded data
     * @param maxFamilyId - Maximum family ID found in loaded data
     * @param maxVillageId - Maximum village ID found in loaded data
     */
    async syncFromLoadedData(maxPeopleId: number, maxFamilyId: number, maxVillageId: number): Promise<void> {
        const updates: Array<{ entityType: string; maxId: number }> = [
            { entityType: 'people', maxId: maxPeopleId },
            { entityType: 'family', maxId: maxFamilyId },
            { entityType: 'villages', maxId: maxVillageId }
        ];

        for (const { entityType, maxId } of updates) {
            const poolInfo = this.pools[entityType];
            if (!poolInfo) continue;

            const nextId = maxId + 1;
            poolInfo.localNext = nextId;
            poolInfo.localMax = nextId;

            if (storage.isAvailable()) {
                try {
                    // Set the Redis counter to the max ID found
                    await storage.set(poolInfo.redisKey, maxId.toString());
                    if (serverConfig.verboseLogs) {
                        console.log(`🔢 [IdAllocator] Synced ${entityType} counter to ${nextId} after load`);
                    }
                } catch (err) {
                    console.warn(`[IdAllocator] Failed to sync ${entityType} counter to Redis:`, err);
                }
            }
        }
    }

    /**
     * Get the current counter values for save operations
     * Used when saving to sync Postgres sequences
     */
    async getCountersForSave(): Promise<{ people: number; family: number; villages: number }> {
        const result: { people: number; family: number; villages: number } = {
            people: 0,
            family: 0,
            villages: 0
        };

        for (const entityType of ['people', 'family', 'villages'] as const) {
            const poolInfo = this.pools[entityType];
            if (storage.isAvailable()) {
                try {
                    const current = await storage.get(poolInfo.redisKey);
                    result[entityType] = current ? parseInt(current, 10) : poolInfo.localMax - 1;
                } catch {
                    result[entityType] = poolInfo.localMax - 1;
                }
            } else {
                result[entityType] = poolInfo.localMax - 1;
            }
        }

        return result;
    }

    /**
     * Reset counters (for testing or world restart)
     */
    async reset(): Promise<void> {
        for (const [entityType, poolInfo] of Object.entries(this.pools)) {
            poolInfo.localNext = 1;
            poolInfo.localMax = 1;

            if (storage.isAvailable()) {
                try {
                    await storage.del(poolInfo.redisKey);
                } catch (err) {
                    console.warn(`[IdAllocator] Failed to reset ${entityType} counter:`, err);
                }
            }
        }
        this.initialized = false;
    }

    /**
     * Convenience methods for specific entity types
     */
    async getNextPersonId(): Promise<number> {
        return this.getNextId('people');
    }

    async getNextFamilyId(): Promise<number> {
        return this.getNextId('family');
    }

    async getNextVillageId(): Promise<number> {
        return this.getNextId('villages');
    }

    async getPersonIdBatch(count: number): Promise<number[]> {
        return this.getIdBatch('people', count);
    }

    async getFamilyIdBatch(count: number): Promise<number[]> {
        return this.getIdBatch('family', count);
    }

    async getVillageIdBatch(count: number): Promise<number[]> {
        return this.getIdBatch('villages', count);
    }

    /**
     * Get remaining IDs in a pool (for debugging)
     */
    getPoolStatus(entityType: string): { available: number; next: number; max: number } | null {
        const poolInfo = this.pools[entityType];
        if (!poolInfo) return null;
        return {
            available: poolInfo.localMax - poolInfo.localNext,
            next: poolInfo.localNext,
            max: poolInfo.localMax
        };
    }

    /**
     * Get status of all pools
     */
    getAllPoolStatus(): { people: ReturnType<typeof this.getPoolStatus>; family: ReturnType<typeof this.getPoolStatus>; villages: ReturnType<typeof this.getPoolStatus> } {
        return {
            people: this.getPoolStatus('people'),
            family: this.getPoolStatus('family'),
            villages: this.getPoolStatus('villages')
        };
    }
}

// Singleton instance
const idAllocator = new IdAllocator();

export default idAllocator;
