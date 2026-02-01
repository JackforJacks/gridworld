import storage from './storage';
import serverConfig from '../config/server';
import StateManager from './stateManager';

class VillageService {
    // Static timer for food updates (legacy - now tick-based)
    static foodUpdateTimer: ReturnType<typeof setInterval> | null = null;
    // Socket instance for emitting real-time updates (set by server)
    static io: any = null;
    // Flag to use Redis or PostgreSQL (auto-detected based on Redis availability)
    static useRedis: boolean = true;
    // Calendar service reference for tick-based updates
    static calendarService: any = null;

    static setIo(io: any): void {
        this.io = io;
        StateManager.setIo(io);
    }

    /**
     * Setup tick-based food updates (replaces interval timer)
     * Food production now happens on calendar ticks instead of wall-clock time
     * @param {any} calendarService - The calendar service instance
     */
    static setupTickBasedFoodUpdates(calendarService: any): void {
        this.calendarService = calendarService;
        const storageMode = this.useRedis && storage.isAvailable();
        if (serverConfig.verboseLogs) console.log(`🍖 Setting up tick-based food updates [storage mode: ${storageMode}]`);

        calendarService.on('tick', async (tickData: any) => {
            try {
                // Update food on each calendar tick using Redis only.
                // If Redis isn't available, skip updates rather than falling back to Postgres.
                if (storage.isAvailable()) {
                    await this.updateAllVillageFoodStoresRedis();
                } else {
                    console.warn('[villageService] Redis not available - skipping food update (Redis-only mode)');
                }
            } catch (error: unknown) {
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
        } catch (e: unknown) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.warn('[villageService] Failed to start fallback food timer:', error.message);
        }
    }

    /**
     * Start automatic food store updates (LEGACY - use setupTickBasedFoodUpdates instead)
     * @param {number} intervalMs - Update interval in milliseconds (default: 1000ms = 1 second)
     */
    static startFoodUpdateTimer(intervalMs: number = 1000): void {
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
            } catch (error: unknown) {
                console.error('Error in food update timer:', error);
            }
        }, intervalMs);
    }

    /**
     * Stop automatic food store updates
     */
    static stopFoodUpdateTimer(): void {
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
    static calculateFoodCapacity(housingCapacity: number): number {
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
    static calculateFoodProduction(fertility: number, clearedChunks: number, population: number): number {
        // Base production: fertility factor * cleared land * population efficiency
        // Scaled down by factor of 100 for slower production rates
        const baseRate = (fertility / 100) * clearedChunks * Math.sqrt(population + 1);
        return Math.max(0, baseRate * 0.1);
    }

    /**
     * Update food production rate for a village (Redis-first)
     * @param {number} villageId - Village ID
     * @returns {Promise<any>} Updated village data
     */
    static async updateVillageFoodProduction(villageId: number): Promise<any> {
        try {
            // Get village data from Redis
            const village = await StateManager.getVillage(villageId);
            if (!village) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            // Get fertility from Redis
            const fertility = parseInt(await StateManager.getTileFertility(String(village.tile_id))) || 0;

            // Get cleared land count from Redis
            const clearedChunks = parseInt(await StateManager.getVillageClearedLand(String(villageId))) || 0;

            // Get population count from Redis
            const population = parseInt(await StateManager.getVillagePopulation(String(village.tile_id), village.land_chunk_index)) || 0;

            // Calculate new production rate
            const foodProductionRate = this.calculateFoodProduction(fertility, clearedChunks, population);

            // Update village in Redis with new production rate
            const updatedVillage = {
                ...village,
                food_production_rate: foodProductionRate
            };

            await storage.hset('village', villageId.toString(), JSON.stringify(updatedVillage));

            return updatedVillage;
        } catch (error: unknown) {
            console.error('Error updating village food production:', error);
            throw error;
        }
    }

    /**
     * Update food capacity for a village (Redis-first)
     * @param {number} villageId - Village ID
     * @returns {Promise<any>} Updated village data
     */
    static async updateVillageFoodCapacity(villageId: number): Promise<any> {
        try {
            // Get village data from Redis
            const village = await StateManager.getVillage(villageId);
            if (!village) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            const housingCapacity = parseInt(village.housing_capacity) || 1000;
            const foodCapacity = this.calculateFoodCapacity(housingCapacity);

            // Update village in Redis with new food capacity
            const updatedVillage = {
                ...village,
                food_capacity: foodCapacity
            };

            await storage.hset('village', villageId.toString(), JSON.stringify(updatedVillage));

            return updatedVillage;
        } catch (error: unknown) {
            console.error('Error updating village food capacity:', error);
            throw error;
        }
    }

    /**
     * Update food stores for a village (Redis-first)
     * @param {number} villageId - Village ID
     * @returns {Promise<any>} Updated village data
     */
    static async updateVillageFoodStores(villageId: number): Promise<any> {
        try {
            // First update the production rate to ensure it's current
            await this.updateVillageFoodProduction(villageId);

            // Get current village data from Redis
            const village = await StateManager.getVillage(villageId);
            if (!village) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            // For Redis-first, we add 1 second of production (same as tick updates)
            const currentStores = parseFloat(village.food_stores) || 0;
            const newFoodStores = Math.min(
                village.food_capacity || 100000,
                Math.max(0, currentStores + village.food_production_rate)
            );

            if (serverConfig.verboseLogs) console.log(`Village ${villageId}: rate=${village.food_production_rate}, old=${currentStores}, new=${newFoodStores}`);

            // Update village in Redis with new food stores
            const updatedVillage = {
                ...village,
                food_stores: newFoodStores
            };

            await storage.hset('village', villageId.toString(), JSON.stringify(updatedVillage));

            return updatedVillage;
        } catch (error: unknown) {
            console.error('Error updating village food stores:', error);
            throw error;
        }
    }

    /**
     * Get village data with current food information (Redis-first)
     * @param {number} villageId - Village ID
     * @returns {Promise<any>} Village data including food info
     */
    static async getVillageWithFoodInfo(villageId: number): Promise<any> {
        try {
            // First update food stores to ensure current data
            await this.updateVillageFoodStores(villageId);

            // Get updated village data from Redis
            const village = await StateManager.getVillage(villageId);
            if (!village) {
                throw new Error(`Village with ID ${villageId} not found`);
            }

            // Get additional data from Redis
            const fertility = await StateManager.getTileFertility(String(village.tile_id));
            const clearedChunks = await StateManager.getVillageClearedLand(String(villageId));
            const population = await StateManager.getVillagePopulation(String(village.tile_id), village.land_chunk_index);

            return {
                ...village,
                fertility: parseInt(fertility) || 0,
                total_chunks: 100, // Assuming 100 chunks per tile
                cleared_chunks: parseInt(clearedChunks) || 0,
                population: parseInt(population) || 0
            };
        } catch (error: unknown) {
            console.error('Error getting village food info:', error);
            throw error;
        }
    }



    /**
     * Update all village food stores using Redis (no database writes!)
     * This is the high-performance version for 1M+ populations
     * @returns {Promise<any[]>} Array of updated villages
     */
    static async updateAllVillageFoodStoresRedis(): Promise<any[]> {
        try {
            const villages = await StateManager.getAllVillages();
            if (!villages || villages.length === 0) {
                if (serverConfig.verboseLogs) {
                    console.warn('[VillageService] No villages in storage when running food update');
                }
                return [];
            }

            const pipeline = storage.pipeline();
            const updatedVillages: any[] = [];

            for (const village of villages) {
                // Get fertility from Redis
                let fertilityStr = await StateManager.getTileFertility(String(village.tile_id));
                const fertility = parseInt(fertilityStr) || 0;

                // Get cleared land count from Redis
                let clearedCntStr = await StateManager.getVillageClearedLand(String(village.id));
                const clearedCnt = parseInt(clearedCntStr) || 0;

                // Get population count from Redis index
                let populationStr = await StateManager.getVillagePopulation(String(village.tile_id), village.land_chunk_index);
                let population = parseInt(populationStr) || 0;

                // Fallback: if no indexed residency population exists, count people by tile
                // (handles cases where `person.residency` wasn't set during storage-first seeding)
                if (population === 0) {
                    try {
                        // Use HSCAN streaming to avoid loading all people into memory
                        const tileId = parseInt(village.tile_id as string);
                        let count = 0;
                        const peopleStream = storage.hscanStream('person', { count: 500 });
                        for await (const result of peopleStream) {
                            const entries = result as string[];
                            for (let i = 0; i < entries.length; i += 2) {
                                const json = entries[i + 1];
                                if (!json) continue;
                                try {
                                    const p = JSON.parse(json);
                                    if (parseInt(p.tile_id) === tileId) count++;
                                } catch { /* skip */ }
                            }
                        }
                        population = count;
                        if (serverConfig.verboseLogs) console.log(`[villageService] Fallback population count for village ${village.id} (tile ${village.tile_id}) => ${population}`);
                    } catch (e: unknown) {
                        const error = e instanceof Error ? e : new Error(String(e));
                        if (serverConfig.verboseLogs) console.warn('[villageService] Failed to compute fallback population:', error.message);
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
                } catch (e: unknown) {
                    const error = e instanceof Error ? e : new Error(String(e));
                    console.warn('[villageService] Failed to emit village updates via socket:', error.message);
                }
            }

            return updatedVillages;
        } catch (error: unknown) {
            console.error('Error updating village food stores in Redis:', error);
            throw error;
        }
    }
}

export default VillageService;