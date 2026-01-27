/**
 * VillagePopulationState - Redis state management for village population tracking
 * 
 * Handles:
 * - Village pending operations (for new villages created in Redis)
 * - Village ID reassignment after Postgres sync
 */

const storage = require('../storage');

class VillagePopulationState {
    static nextVillageTempId = -1;

    /**
     * Get a new temporary ID for a village created in storage-only mode
     */
    static async getNextTempId() {
        if (!storage.isAvailable()) return this.nextVillageTempId--;
        try {
            const id = await storage.hincrby('counts:global', 'nextVillageTempId', -1);
            return id;
        } catch (err) {
            return this.nextVillageTempId--;
        }
    }

    /**
     * Add a village to pending inserts
     */
    static async markVillageAsNew(villageId) {
        if (!storage.isAvailable()) return false;
        try {
            await storage.sadd('pending:village:inserts', villageId.toString());
            return true;
        } catch (err) {
            console.warn('[VillagePopulationState] markVillageAsNew failed:', err.message);
            return false;
        }
    }

    /**
     * Get pending village inserts (temp IDs)
     */
    static async getPendingInserts() {
        if (!storage.isAvailable()) return [];
        try {
            const ids = await storage.smembers('pending:village:inserts');
            return ids.map(id => parseInt(id, 10));
        } catch (err) {
            console.warn('[VillagePopulationState] getPendingInserts failed:', err.message);
            return [];
        }
    }

    /**
     * Clear pending village operations
     */
    static async clearPendingOperations() {
        if (!storage.isAvailable()) return;
        try {
            await storage.del('pending:village:inserts');
        } catch (err) {
            console.warn('[VillagePopulationState] clearPendingOperations failed:', err.message);
        }
    }

    /**
     * Reassign temporary village IDs to Postgres IDs after batch insert
     * @param {Array} mappings - Array of { tempId, newId }
     */
    static async reassignIds(mappings) {
        if (!storage.isAvailable()) return;
        try {
            const readPipeline = storage.pipeline();
            for (const { tempId } of mappings) {
                readPipeline.hget('village', tempId.toString());
                readPipeline.hget('village:cleared', tempId.toString());
            }
            const readResults = await readPipeline.exec();

            const writePipeline = storage.pipeline();
            for (let i = 0; i < mappings.length; i++) {
                const { tempId, newId } = mappings[i];
                const [vErr, vJson] = readResults[i * 2] || [];
                const [cErr, clearedVal] = readResults[i * 2 + 1] || [];

                if (vErr || !vJson) continue;
                let village;
                try { village = JSON.parse(vJson); } catch { continue; }

                // Remove old entry and add with new ID
                writePipeline.hdel('village', tempId.toString());
                village.id = newId;
                delete village._isNew;
                writePipeline.hset('village', newId.toString(), JSON.stringify(village));

                // Move cleared land count if exists
                if (clearedVal) {
                    writePipeline.hset('village:cleared', newId.toString(), clearedVal);
                    writePipeline.hdel('village:cleared', tempId.toString());
                }
            }
            await writePipeline.exec();

            // Clear the pending inserts we just processed
            const delPipeline = storage.pipeline();
            for (const { tempId } of mappings) {
                delPipeline.srem('pending:village:inserts', tempId.toString());
            }
            await delPipeline.exec();
        } catch (err) {
            console.warn('[VillagePopulationState] reassignIds failed:', err.message);
        }
    }
}

module.exports = VillagePopulationState;
