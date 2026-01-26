const pool = require('../config/database');

class VillageService {
    // Static timer for food updates
    static foodUpdateTimer = null;
    // Socket instance for emitting real-time updates (set by server)
    static io = null;

    static setIo(io) {
        this.io = io;
    }
    /**
     * Start automatic food store updates
     * @param {number} intervalMs - Update interval in milliseconds (default: 1000ms = 1 second)
     */
    static startFoodUpdateTimer(intervalMs = 1000) {
        if (this.foodUpdateTimer) {
            console.log('Food update timer already running');
            return;
        }

        console.log(`🍖 Starting food update timer (${intervalMs}ms intervals)`);
        this.foodUpdateTimer = setInterval(async () => {
            try {
                await this.updateAllVillageFoodStores();
            } catch (error) {
                console.error('Error in food update timer:', error);
            }
        }, intervalMs);
    }

    /**
     * Stop automatic food store updates
     */
    static stopFoodUpdateTimer() {
        if (this.foodUpdateTimer) {
            console.log('🍖 Stopping food update timer');
            clearInterval(this.foodUpdateTimer);
            this.foodUpdateTimer = null;
        }
    }

    /**
     * Calculate food storage capacity for a village based on housing capacity
     * @param {number} housingCapacity - Housing capacity of the village
     * @returns {number} Food storage capacity (capped at 1000)
     */
    static calculateFoodCapacity(housingCapacity) {
        // Food capacity scales with housing capacity but is capped at 1000
        return Math.min(1000, housingCapacity);
    }

    /**
     * Calculate food production rate for a village
     * @param {number} fertility - Tile fertility (0-100)
     * @param {number} clearedChunks - Number of cleared land chunks
     * @param {number} population - Village population
     * @returns {number} Food production rate in food per second
     */
    static calculateFoodProduction(fertility, clearedChunks, population) {
        // Base production: fertility factor * cleared land * population efficiency
        // Scale down by factor of 100 for slower production rates
        const baseRate = (fertility / 100) * clearedChunks * Math.sqrt(population + 1);
        return Math.max(0, baseRate * 0.1); // Ensure non-negative and scale down
    }

    /**
     * Update food production rate for a village
     * @param {number} villageId - Village ID
     * @returns {Promise<Object>} Updated village data
     */
    static async updateVillageFoodProduction(villageId) {
        try {
            // Get village data with tile and lands information
            const villageQuery = `
                SELECT v.*,
                       t.fertility,
                       COUNT(tl.id) as total_chunks,
                       COUNT(CASE WHEN tl.cleared THEN 1 END) as cleared_chunks
                FROM villages v
                LEFT JOIN tiles t ON v.tile_id = t.id
                LEFT JOIN tiles_lands tl ON tl.tile_id = v.tile_id AND tl.chunk_index = v.land_chunk_index
                WHERE v.id = $1
                GROUP BY v.id, t.fertility
            `;
            const { rows: villageRows } = await pool.query(villageQuery, [villageId]);

            if (villageRows.length === 0) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            const village = villageRows[0];
            const clearedChunks = parseInt(village.cleared_chunks) || 0;
            const fertility = parseInt(village.fertility) || 0;

            // Get current population in the village
            const populationQuery = `
                SELECT COUNT(*) as population
                FROM people p
                JOIN villages v ON p.tile_id = v.tile_id
                WHERE v.id = $1 AND p.residency = v.land_chunk_index
            `;
            const { rows: popRows } = await pool.query(populationQuery, [villageId]);
            const population = parseInt(popRows[0]?.population) || 0;

            // Calculate new production rate
            const foodProductionRate = this.calculateFoodProduction(fertility, clearedChunks, population);

            // Update village with new production rate (do NOT modify last_food_update here)
            const updateQuery = `
                UPDATE villages
                SET food_production_rate = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *
            `;
            const { rows: updatedRows } = await pool.query(updateQuery, [foodProductionRate, villageId]);

            return updatedRows[0];
        } catch (error) {
            console.error('Error updating village food production:', error);
            throw error;
        }
    }

    /**
     * Update food capacity for a village
     * @param {number} villageId - Village ID
     * @returns {Promise<Object>} Updated village data
     */
    static async updateVillageFoodCapacity(villageId) {
        try {
            // Get village housing capacity
            const { rows: villageRows } = await pool.query(
                'SELECT housing_capacity FROM villages WHERE id = $1',
                [villageId]
            );

            if (villageRows.length === 0) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            const housingCapacity = parseInt(villageRows[0].housing_capacity) || 1000;
            const foodCapacity = this.calculateFoodCapacity(housingCapacity);

            // Update village with new food capacity
            const updateQuery = `
                UPDATE villages
                SET food_capacity = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *
            `;
            const { rows: updatedRows } = await pool.query(updateQuery, [foodCapacity, villageId]);

            return updatedRows[0];
        } catch (error) {
            console.error('Error updating village food capacity:', error);
            throw error;
        }
    }

    /**
     * Update food stores for a village based on time elapsed
     * @param {number} villageId - Village ID
     * @returns {Promise<Object>} Updated village data
     */
    static async updateVillageFoodStores(villageId) {
        try {
            // First update the production rate to ensure it's current
            await this.updateVillageFoodProduction(villageId);

            // Get current village data
            const { rows: villageRows } = await pool.query(
                'SELECT * FROM villages WHERE id = $1',
                [villageId]
            );

            if (villageRows.length === 0) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            const village = villageRows[0];
            const lastUpdate = new Date(village.last_food_update);
            const now = new Date();
            const secondsElapsed = (now - lastUpdate) / 1000;

            // Calculate food produced since last update
            const foodProduced = village.food_production_rate * secondsElapsed;

            // Update food stores and timestamp (capped at food capacity)
            const foodCapacity = village.food_capacity || 1000;
            const newFoodStores = Math.min(foodCapacity, Math.max(0, village.food_stores + foodProduced));

            console.log(`Village ${villageId}: rate=${village.food_production_rate}, elapsed=${secondsElapsed}s, produced=${foodProduced}, old=${village.food_stores}, new=${newFoodStores}`);

            const updateQuery = `
                UPDATE villages
                SET food_stores = $1, last_food_update = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *
            `;
            const { rows: updatedRows } = await pool.query(updateQuery, [newFoodStores, villageId]);

            return updatedRows[0];
        } catch (error) {
            console.error('Error updating village food stores:', error);
            throw error;
        }
    }

    /**
     * Get village data with current food information
     * @param {number} villageId - Village ID
     * @returns {Promise<Object>} Village data including food info
     */
    static async getVillageWithFoodInfo(villageId) {
        try {
            // First update food stores to ensure current data
            await this.updateVillageFoodStores(villageId);

            // Then get updated data with tile and lands info
            const query = `
                SELECT v.*,
                       t.fertility,
                       COUNT(tl.id) as total_chunks,
                       COUNT(CASE WHEN tl.cleared THEN 1 END) as cleared_chunks
                FROM villages v
                LEFT JOIN tiles t ON v.tile_id = t.id
                LEFT JOIN tiles_lands tl ON tl.tile_id = v.tile_id AND tl.chunk_index = v.land_chunk_index
                WHERE v.id = $1
                GROUP BY v.id, t.fertility
            `;
            const { rows } = await pool.query(query, [villageId]);

            if (rows.length === 0) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            return rows[0];
        } catch (error) {
            console.error('Error getting village food info:', error);
            throw error;
        }
    }

    /**
     * Update food production rates for all villages
     * @returns {Promise<Array>} Array of updated villages
     */
    static async updateAllVillageFoodProduction() {
        try {
            // Get all village IDs
            const { rows: villageIds } = await pool.query('SELECT id FROM villages');

            const updatedVillages = [];
            for (const { id } of villageIds) {
                const updated = await this.updateVillageFoodProduction(id);
                updatedVillages.push(updated);
            }

            return updatedVillages;
        } catch (error) {
            console.error('Error updating all village food production:', error);
            throw error;
        }
    }

    /**
     * Update food capacity for all villages
     * @returns {Promise<Array>} Array of updated villages
     */
    static async updateAllVillageFoodCapacity() {
        try {
            // Get all village IDs
            const { rows: villageIds } = await pool.query('SELECT id FROM villages');

            const updatedVillages = [];
            for (const { id } of villageIds) {
                const updated = await this.updateVillageFoodCapacity(id);
                updatedVillages.push(updated);
            }

            return updatedVillages;
        } catch (error) {
            console.error('Error updating all village food capacity:', error);
            throw error;
        }
    }

    /**
     * Update food stores for all villages based on time elapsed
     * @returns {Promise<Array>} Array of updated villages
     */
    static async updateAllVillageFoodStores() {
        try {
            console.log('🍖 Updating food stores for all villages...');
            // Get all village IDs
            const { rows: villageIds } = await pool.query('SELECT id FROM villages');

            const updatedVillages = [];
            for (const { id } of villageIds) {
                const updated = await this.updateVillageFoodStores(id);
                updatedVillages.push(updated);
            }

            console.log(`🍖 Updated food stores for ${updatedVillages.length} villages`);

            // Emit updates to connected clients so the UI can update in real time
            if (this.io && updatedVillages.length > 0) {
                try {
                    // Emit the full batch and individual updates
                    this.io.emit('villagesUpdated', updatedVillages);
                    for (const v of updatedVillages) {
                        this.io.emit('villageUpdated', v);
                    }
                } catch (e) {
                    console.warn('[villageService] Failed to emit village updates via socket:', e.message);
                }
            }

            return updatedVillages;
        } catch (error) {
            console.error('Error updating all village food stores:', error);
            throw error;
        }
    }
}

module.exports = VillageService;