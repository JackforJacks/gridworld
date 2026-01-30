/**
 * ID Allocator - Pre-allocates IDs from Postgres sequences for use in Redis
 * 
 * Reserves blocks of IDs from Postgres sequences without inserting rows.
 * This allows Redis to use real Postgres IDs, eliminating the need for
 * ID remapping when saving to Postgres.
 */

import pool from '../config/database';
import serverConfig from '../config/server';

interface PoolInfo {
    next: number;
    max: number;
    sequence: string;
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

    constructor() {
        // ID pools for each entity type
        this.pools = {
            people: { next: 0, max: 0, sequence: 'people_id_seq' },
            family: { next: 0, max: 0, sequence: 'family_id_seq' },
            villages: { next: 0, max: 0, sequence: 'villages_id_seq' }
        };
        this.defaultBlockSize = 1000;
    }

    /**
     * Reserve a block of IDs from a Postgres sequence
     * @param {string} entityType - 'people', 'family', or 'villages'
     * @param {number} count - Number of IDs needed
     * @returns {Promise<void>}
     */
    async refillPool(entityType, count) {
        const poolInfo = this.pools[entityType];
        if (!poolInfo) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        const blockSize = Math.max(this.defaultBlockSize, count);

        try {
            // Reserve a block of IDs atomically
            // setval returns the new value, we calculate the first ID in our block
            const result = await pool.query(
                `SELECT setval($1, nextval($1) + $2 - 1) - $2 + 1 AS first_id`,
                [poolInfo.sequence, blockSize]
            );

            poolInfo.next = parseInt(result.rows[0].first_id, 10);
            poolInfo.max = poolInfo.next + blockSize;

            if (serverConfig.verboseLogs) console.log(`🔢 Reserved ${blockSize} ${entityType} IDs: ${poolInfo.next} - ${poolInfo.max - 1}`);
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            console.error(`Failed to reserve ${entityType} IDs:`, error.message);
            throw error;
        }
    }

    /**
     * Get the next available ID for an entity type
     * @param {string} entityType - 'people', 'family', or 'villages'
     * @returns {Promise<number>}
     */
    async getNextId(entityType) {
        const poolInfo = this.pools[entityType];
        if (!poolInfo) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        // Refill if pool is empty
        if (poolInfo.next >= poolInfo.max) {
            await this.refillPool(entityType, 1);
        }

        return poolInfo.next++;
    }

    /**
     * Get a batch of IDs for an entity type
     * @param {string} entityType - 'people', 'family', or 'villages'
     * @param {number} count - Number of IDs needed
     * @returns {Promise<number[]>}
     */
    async getIdBatch(entityType, count) {
        const poolInfo = this.pools[entityType];
        if (!poolInfo) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        // Check if we have enough IDs in the pool
        const available = poolInfo.max - poolInfo.next;
        if (available < count) {
            await this.refillPool(entityType, count);
        }

        // Allocate the IDs
        const firstId = poolInfo.next;
        poolInfo.next += count;

        // Use Uint32Array internally for memory efficiency (4 bytes per ID vs 8)
        const idsTyped = new Uint32Array(count);
        for (let i = 0; i < count; i++) {
            idsTyped[i] = firstId + i;
        }
        // Return a plain Array for callers/tests for compatibility
        return Array.from(idsTyped);
    }

    /**
     * Convenience methods for specific entity types
     */
    async getNextPersonId() {
        return this.getNextId('people');
    }

    async getNextFamilyId() {
        return this.getNextId('family');
    }

    async getNextVillageId() {
        return this.getNextId('villages');
    }

    async getPersonIdBatch(count) {
        return this.getIdBatch('people', count);
    }

    async getFamilyIdBatch(count) {
        return this.getIdBatch('family', count);
    }

    async getVillageIdBatch(count) {
        return this.getIdBatch('villages', count);
    }

    /**
     * Get remaining IDs in a pool (for debugging)
     */
    getPoolStatus(entityType) {
        const poolInfo = this.pools[entityType];
        if (!poolInfo) return null;
        return {
            available: poolInfo.max - poolInfo.next,
            next: poolInfo.next,
            max: poolInfo.max
        };
    }

    /**
     * Get status of all pools
     */
    getAllPoolStatus() {
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
