const pool = require('../config/database');
const storage = require('./storage');
const serverConfig = require('../config/server.js');
const StateManager = require('./stateManager');

class VillageService {
    // Static timer for food updates (legacy - now tick-based)
    static foodUpdateTimer = null;
    // Socket instance for emitting real-time updates (set by server)
    static io = null;
    // Flag to use Redis or PostgreSQL (auto-detected based on Redis availability)
    static useRedis = true;
    // Calendar service reference for tick-based updates
    static calendarService = null;

    static setIo(io) {
        this.io = io;
        StateManager.setIo(io);
    }

    /**
     * Setup tick-based food updates (replaces interval timer)
     * Food production now happens on calendar ticks instead of wall-clock time
     * @param {CalendarService} calendarService - The calendar service instance
     */
    static setupTickBasedFoodUpdates(calendarService) {
        this.calendarService = calendarService;
        const storageMode = this.useRedis && storage.isAvailable();
        if (serverConfig.verboseLogs) console.log(`🍖 Setting up tick-based food updates [storage mode: ${storageMode}]`);

        calendarService.on('tick', async (tickData) => {
            try {
                // Update food on each calendar tick using Redis only.
                // If Redis isn't available, skip updates rather than falling back to Postgres.
                if (storage.isAvailable()) {
                    await this.updateAllVillageFoodStoresRedis();
                } else {
                    console.warn('[villageService] Redis not available - skipping food update (Redis-only mode)');
                }
            } catch (error) {
                console.error('Error in tick-based food update:', error);
            }
        });

        // If the calendar is not running (e.g., autoStart disabled), start a fallback timer
        // so food production still updates in environments where calendar ticks aren't active.
        try {
            if (!calendarService.state || !calendarService.state.isRunning) {
                if (process.env.NODE_ENV !== 'test') {
                    if (serverConfig.verboseLogs) console.log('🍖 Calendar not running — starting fallback food update timer');
                    this.startFoodUpdateTimer(this.calendarService && this.calendarService.internalConfig ? this.calendarService.internalConfig.realTimeTickMs : 1000);
                }
            }
        } catch (e) {
            console.warn('[villageService] Failed to start fallback food timer:', e && e.message ? e.message : e);
        }
    }

    /**
     * Start automatic food store updates (LEGACY - use setupTickBasedFoodUpdates instead)
     * @param {number} intervalMs - Update interval in milliseconds (default: 1000ms = 1 second)
     */
    static startFoodUpdateTimer(intervalMs = 1000) {
        if (this.foodUpdateTimer) {
            if (serverConfig.verboseLogs) console.log('Food update timer already running');
            return;
        }

        const storageMode = this.useRedis && storage.isAvailable();
        if (serverConfig.verboseLogs) console.log(`🍖 Starting food update timer (${intervalMs}ms intervals) [storage mode: ${storageMode}]`);

        this.foodUpdateTimer = setInterval(async () => {
            try {
                // Redis-only mode: update via Redis if available, otherwise skip.
                if (storage.isAvailable()) {
                    await this.updateAllVillageFoodStoresRedis();
                } else {
                    if (serverConfig.verboseLogs) console.warn('🍖 Redis unavailable - skipping food update (Redis-only mode)');
                }
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
            if (serverConfig.verboseLogs) console.log('🍖 Stopping food update timer');
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
        return Math.min(1000, housingCapacity * 100);
    }

    /**
     * Calculate food production rate for a village
     * @param {number} fertility - Tile fertility (0-100)
     * @param {number} clearedChunks - Number of cleared land chunks
     * @param {number} population - Village population
     * @returns {number} Food production rate per second (float)
     */
    static calculateFoodProduction(fertility, clearedChunks, population) {
        // Base production: fertility factor * cleared land * population efficiency
        // Scaled down by factor of 100 for slower production rates
        const baseRate = (fertility / 100) * clearedChunks * Math.sqrt(population + 1);
        return Math.max(0, baseRate * 0.1);
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
            const timeDelta = now - lastUpdate; // milliseconds
            const foodProduced = (village.food_production_rate * timeDelta) / 1000;

            // Update food stores and timestamp (capped at food capacity)
            const foodCapacity = village.food_capacity || 100000;
            const newFoodStores = Math.min(foodCapacity, Math.max(0, village.food_stores + foodProduced));

            if (serverConfig.verboseLogs) console.log(`Village ${villageId}: rate=${village.food_production_rate}, elapsed=${secondsElapsed}s, produced=${foodProduced}, old=${village.food_stores}, new=${newFoodStores}`);

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
     * Update food production rates for all villages in a single batch query
     * @returns {Promise<Array>} Array of updated villages
     */
    static async updateAllVillageFoodProduction() {
        try {
            // Single batch query using CTE to calculate production rates
            const { rows: updatedVillages } = await pool.query(`
                WITH village_stats AS (
                    SELECT 
                        v.id as village_id,
                        COALESCE(t.fertility, 0) as fertility,
                        (SELECT COUNT(*) FROM tiles_lands tl 
                         WHERE tl.tile_id = v.tile_id 
                         AND tl.chunk_index = v.land_chunk_index 
                         AND tl.cleared = true) as cleared_cnt,
                        -- Fallback to counting people by tile_id so villages still
                        -- produce food even if individual residency hasn't been
                        -- assigned to the land_chunk_index yet (e.g., after a
                        -- storage-first seed where residency may be pending).
                        (SELECT COUNT(*) FROM people p 
                         WHERE p.tile_id = v.tile_id) as pop_cnt
                    FROM villages v
                    LEFT JOIN tiles t ON v.tile_id = t.id
                )
                UPDATE villages v
                SET 
                    food_production_rate = GREATEST(0, FLOOR(
                        (vs.fertility / 100.0) * 
                        vs.cleared_cnt * 
                        SQRT(vs.pop_cnt + 1) * 10
                    )),
                    updated_at = CURRENT_TIMESTAMP
                FROM village_stats vs
                WHERE v.id = vs.village_id
                RETURNING v.*
            `);

            return updatedVillages;
        } catch (error) {
            console.error('Error updating all village food production:', error);
            throw error;
        }
    }

    /**
     * Update food capacity for all villages in a single batch query
     * @returns {Promise<Array>} Array of updated villages
     */
    static async updateAllVillageFoodCapacity() {
        try {
            // Single batch query: update all food capacities at once
            const { rows: updatedVillages } = await pool.query(`
                UPDATE villages
                SET 
                    food_capacity = LEAST(1000, COALESCE(housing_capacity, 1000) * 100),
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `);

            return updatedVillages;
        } catch (error) {
            console.error('Error updating all village food capacity:', error);
            throw error;
        }
    }

    /**
     * Update food stores for all villages in a single batch query
     * Uses time elapsed since last update to calculate food produced
     * @returns {Promise<Array>} Array of updated villages
     */
    static async updateAllVillageFoodStores() {
        try {
            // First, batch update all production rates (1 query)
            await this.updateAllVillageFoodProduction();

            // Then batch update all food stores based on elapsed time (1 query)
            const { rows: updatedVillages } = await pool.query(`
                UPDATE villages
                SET 
                    food_stores = LEAST(
                        COALESCE(food_capacity, 1000),
                        GREATEST(0, 
                            FLOOR(COALESCE(food_stores, 0) + 
                            COALESCE(food_production_rate, 0) * 
                            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_food_update, NOW()))))
                        )
                    ),
                    last_food_update = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `);

            console.log(`🍖 Batch updated food stores for ${updatedVillages.length} villages`);

            // Emit updates to connected clients so the UI can update in real time
            if (this.io && updatedVillages.length > 0) {
                try {
                    this.io.emit('villagesUpdated', updatedVillages);
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

    /**
     * Update all village food stores using Redis (no database writes!)
     * This is the high-performance version for 1M+ populations
     * @returns {Promise<Array>} Array of updated villages
     */
    static async updateAllVillageFoodStoresRedis() {
        try {
            const villages = await StateManager.getAllVillages();
            if (villages.length === 0) return [];

            const pipeline = storage.pipeline();
            const updatedVillages = [];

            for (const village of villages) {
                // Get fertility from Redis
                let fertility = await StateManager.getTileFertility(village.tile_id);
                fertility = parseInt(fertility) || 0;

                // Get cleared land count from Redis
                let clearedCnt = await StateManager.getVillageClearedLand(village.id);
                clearedCnt = parseInt(clearedCnt) || 0;

                // Get population count from Redis index
                let population = await StateManager.getVillagePopulation(village.tile_id, village.land_chunk_index);
                population = parseInt(population) || 0;

                // Fallback: if no indexed residency population exists, count people by tile
                // (handles cases where `person.residency` wasn't set during storage-first seeding)
                if (population === 0) {
                    try {
                        const people = await StateManager.getAllPeople();
                        population = people.filter(p => parseInt(p.tile_id) === parseInt(village.tile_id)).length;
                        if (serverConfig.verboseLogs) console.log(`[villageService] Fallback population count for village ${village.id} (tile ${village.tile_id}) => ${population}`);
                    } catch (e) {
                        if (serverConfig.verboseLogs) console.warn('[villageService] Failed to compute fallback population:', e && e.message ? e.message : e);
                    }
                }

                // Calculate production rate
                const productionRate = this.calculateFoodProduction(fertility, clearedCnt, population);

                // Update food stores (add 1 second of production)
                const currentStores = parseFloat(village.food_stores) || 0;
                const newFoodStores = Math.min(
                    village.food_capacity || 100000,
                    Math.max(0, currentStores + productionRate)
                );

                // Update in Redis
                const updatedVillage = {
                    ...village,
                    food_stores: newFoodStores,
                    food_production_rate: productionRate,
                };
                pipeline.hset('village', village.id.toString(), JSON.stringify(updatedVillage));
                updatedVillages.push(updatedVillage);
            }

            await pipeline.exec();

            // Emit to clients
            if (this.io && updatedVillages.length > 0) {
                try {
                    this.io.emit('villagesUpdated', updatedVillages);
                } catch (e) {
                    console.warn('[villageService] Failed to emit village updates via socket:', e.message);
                }
            }

            return updatedVillages;
        } catch (error) {
            console.error('Error updating village food stores in Redis:', error);
            throw error;
        }
    }
}

module.exports = VillageService;