// Population Service - Handles population growth and updates
const pool = require('../config/database.js');
const config = require('../config/server.js');

// Calculator utilities
const {
    calculateAge,
    trackBirths,
    trackDeaths,
    calculateRates,
    resetRateCounters,
    stopRateTracking,
    getTotalPopulation
} = require('./population/calculator.js');

// Population management
const { addPeopleToTile, removePeopleFromTile } = require('./population/manager.js');
const { applySenescence } = require('./population/death.js');

// Service modules
const {
    initializePopulationService,
    ensureTableExists,
    initializeDatabase,
    startAutoSave
} = require('./population/initializer.js');
const { fetchPopulationStats } = require('./population/PopulationStats.js');
const { Procreation } = require('./population/family.js');

class PopulationService {
    #pool;

    constructor(io, calendarService = null) {
        // Core dependencies
        this.io = io;
        this.calendarService = calendarService;
        this.#pool = pool;

        // Interval management
        this.growthInterval = null;
        this.autoSaveInterval = null;
        this.rateInterval = null;

        // Configuration
        this.isGrowthEnabled = false;
        this.batchUpdateThreshold = config.populationBatchSize || 100;
        this.rateTrackingInterval = config.rateTrackingInterval || 60000;

        // Tracking counters
        this.birthCount = 0;
        this.deathCount = 0;
        this.lastRateReset = Date.now();
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Provides access to the database pool for external modules
     * @returns {Pool} Database pool instance
     */
    getPool() {
        return this.#pool;
    }

    /**
     * Validates that tile IDs are in the correct format
     * @param {Array} tileIds - Array of tile IDs to validate
     * @throws {Error} If tileIds format is invalid
     */
    validateTileIds(tileIds) {
        if (!Array.isArray(tileIds) || !tileIds.every(id => typeof id === 'string' || typeof id === 'number')) {
            throw new Error('Invalid tileIds: Must be an array of strings or numbers.');
        }
    }

    /**
     * Gets the current calendar date with fallback handling
     * @returns {Object} Calendar date object with year, month, day
     */
    getCurrentCalendarDate() {
        if (this.calendarService && typeof this.calendarService.getState === 'function') {
            const calendarState = this.calendarService.getState();
            if (calendarState && calendarState.currentDate) {
                return calendarState.currentDate;
            }
            console.warn('[PopulationService] CalendarService.getState() did not return a valid currentDate. Using fallback.');
        } else {
            console.warn('[PopulationService] CalendarService not available. Using fallback date.');
        }

        return { year: 1, month: 1, day: 1 };
    }

    /**
     * Formats population data for client consumption
     * @param {Object} populations - Raw population data
     * @returns {Object} Formatted population data
     */
    getFormattedPopulationData(populations = null) {
        if (!populations) {
            populations = {};
        }
        return {
            tilePopulations: populations,
            totalPopulation: getTotalPopulation(populations),
            totalTiles: Object.keys(populations).length,
            lastUpdated: new Date().toISOString()
        };
    }

    // ==================== INITIALIZATION METHODS ====================

    /**
     * Ensures the people table exists with proper structure
     */
    async ensureTableExists() {
        await ensureTableExists(this.#pool);
    }

    /**
     * Initializes the population service with all dependencies
     * @param {Object} io - Socket.io instance
     * @param {Object} calendarService - Calendar service instance
     */
    async initialize(io, calendarService = null) {
        await initializePopulationService(this, io, calendarService);
    }

    /**
     * Initializes and tests database connection
     */
    async initializeDatabase() {
        await initializeDatabase(this.#pool);
    }

    // ==================== DATA MANAGEMENT METHODS ====================

    /**
     * Loads population data from database
     * @returns {Object} Population data by tile ID
     */
    async loadData() {
        try {
            const result = await this.#pool.query('SELECT tile_id, COUNT(*) as population FROM people GROUP BY tile_id');
            const populations = {};
            result.rows.forEach(row => {
                populations[row.tile_id] = parseInt(row.population, 10);
            });
            return populations;
        } catch (error) {
            console.error('Error loading data from database:', error);
            return {};
        }
    }

    /**
     * Placeholder for data saving logic
     * @returns {boolean} Always returns true for now
     */
    async saveData() {
        return true;
    }

    /**
     * Gets current population data
     * @returns {Object} Current population data
     */
    async getPopulations() {
        return await this.loadData();
    }

    // ==================== POPULATION OPERATIONS ====================

    /**
     * Updates population for a specific tile
     * @param {string|number} tileId - The tile ID
     * @param {number} population - New population count
     */
    async updatePopulation(tileId, population) {
        await Procreation(this.#pool, this.calendarService, this, tileId, population);
    }

    /**
     * Resets all population data
     * @returns {Object} Formatted empty population data
     */
    async resetPopulation() {
        try {
            await this.#pool.query('DROP TABLE IF EXISTS people CASCADE');
            await ensureTableExists(this.#pool);
            await this.broadcastUpdate('populationReset');
            return this.getFormattedPopulationData({});
        } catch (error) {
            console.error('Error resetting population:', error);
            throw error;
        }
    }

    /**
     * Initializes population for multiple tiles
     * @param {Array} tileIds - Array of tile IDs to initialize
     * @returns {Object} Formatted population data
     */
    async initializeTilePopulations(tileIds) {
        if (config.verboseLogs) console.log('[PopulationService] initializeTilePopulations called with tileIds:', tileIds);

        try {
            this.validateTileIds(tileIds);

            if (!Array.isArray(tileIds) || tileIds.length === 0) {
                if (config.verboseLogs) console.warn('[PopulationService] initializeTilePopulations: No tile IDs provided or empty array.');
                return {
                    success: false,
                    message: 'No tile IDs provided',
                    tilePopulations: {},
                    totalPopulation: 0,
                    totalTiles: 0,
                    lastUpdated: new Date().toISOString()
                };
            }

            await this.#pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');
            const { year: currentYear, month: currentMonth, day: currentDay } = this.getCurrentCalendarDate();

            for (const tile_id of tileIds) {
                const tilePopulation = Math.floor(80 + Math.random() * 41);
                await addPeopleToTile(this.#pool, tile_id, tilePopulation, currentYear, currentMonth, currentDay, this, false);
            }

            const populations = await this.loadData();
            return this.getFormattedPopulationData(populations);
        } catch (error) {
            console.error('[PopulationService] Critical error in initializeTilePopulations:', error);
            console.error('[PopulationService] tileIds at time of error:', tileIds);
            throw error;
        }
    }

    /**
     * Updates populations for multiple tiles
     * @param {Object} tilePopulations - Object with tileId -> population mappings
     * @returns {Object} Formatted population data
     */
    async updateTilePopulations(tilePopulations) {
        if (!tilePopulations || typeof tilePopulations !== 'object') {
            throw new Error('tilePopulations must be an object');
        }

        let totalUpdated = 0;
        for (const [tileId, population] of Object.entries(tilePopulations)) {
            if (typeof population === 'number' && population >= 0) {
                await this.updatePopulation(tileId, population);
                totalUpdated++;
            }
        }

        const populations = await this.loadData();
        return this.getFormattedPopulationData(populations);
    }

    /**
     * Regenerates population with new age distribution
     * @returns {Object} Formatted population data
     */
    async regeneratePopulationWithNewAgeDistribution() {
        try {
            console.log('🔄 Regenerating population with new age distribution...');

            const existingPopulations = await this.loadData();
            const tileIds = Object.keys(existingPopulations);

            if (tileIds.length === 0) {
                console.log('No existing population found to regenerate');
                return this.getFormattedPopulationData({});
            }

            const currentPopulations = { ...existingPopulations };
            await this.#pool.query('TRUNCATE TABLE family, people RESTART IDENTITY CASCADE');
            const { year: currentYear, month: currentMonth, day: currentDay } = this.getCurrentCalendarDate();

            for (const tileId of tileIds) {
                const populationCount = currentPopulations[tileId];
                await addPeopleToTile(this.#pool, tileId, populationCount, currentYear, currentMonth, currentDay, this, false);
                console.log(`✅ Regenerated ${populationCount} people for tile ${tileId}`);
            }

            await this.broadcastUpdate('populationRegenerated');
            const populations = await this.loadData();
            console.log('🎉 Population regeneration complete!');

            return this.getFormattedPopulationData(populations);
        } catch (error) {
            console.error('Error regenerating population:', error);
            throw error;
        }
    }

    // ==================== GROWTH AND LIFE CYCLE METHODS ====================

    /**
     * Starts population growth simulation
     */
    startGrowth() {
        this.stopGrowth();
        this.growthInterval = setInterval(async () => {
            try {
                await this.updatePopulations();
            } catch (error) {
                console.error('❌ Error updating populations:', error);
            }
        }, config.populationGrowthInterval);
        console.log('Population growth started.');
    }

    /**
     * Stops population growth simulation
     */
    stopGrowth() {
        if (this.growthInterval) {
            clearInterval(this.growthInterval);
            this.growthInterval = null;
        }
    }

    /**
     * Updates all populations based on growth rate
     */
    async updatePopulations() {
        const populations = await this.loadData();
        const habitableTileIds = Object.keys(populations);

        if (habitableTileIds.length === 0) return;

        const growthRate = config.defaultGrowthRate;
        let totalGrowth = 0;

        for (const tileId of habitableTileIds) {
            const growth = this.calculateGrowthForTile(tileId, growthRate);
            const currentPopulation = populations[tileId];
            const newPopulation = currentPopulation + growth;
            totalGrowth += growth;

            if (growth !== 0) {
                await this.updatePopulation(tileId, newPopulation);
            }
        }

        if (totalGrowth > 0) {
            await this.broadcastUpdate();
        }
    }

    /**
     * Calculates growth for a specific tile
     * @param {string|number} tileId - The tile ID
     * @param {number} baseGrowthRate - Base growth rate
     * @returns {number} Growth amount
     */
    calculateGrowthForTile(tileId, baseGrowthRate) {
        return baseGrowthRate;
    }

    /**
     * Updates growth rate configuration
     * @param {number} rate - New growth rate
     * @returns {Object} Updated population data
     */
    async updateGrowthRate(rate) {
        if (typeof rate !== 'number' || rate < 0) {
            throw new Error('Growth rate must be a non-negative number');
        }

        const responseData = await this.getAllPopulationData();
        if (this.io) {
            this.io.emit('populationUpdate', responseData);
        }
        return responseData;
    }

    /**
     * Manually applies senescence (aging deaths)
     * @returns {Object} Result of senescence application
     */
    async applySenescenceManually() {
        try {
            console.log('🧓 Manually applying senescence...');

            const deaths = await applySenescence(this.#pool, this.calendarService, this);

            if (deaths > 0) {
                await this.broadcastUpdate('senescenceApplied');
            }

            const populations = await this.loadData();
            return {
                success: true,
                deaths: deaths,
                message: `Senescence applied: ${deaths} people died of old age`,
                data: this.getFormattedPopulationData(populations)
            };
        } catch (error) {
            console.error('Error applying manual senescence:', error);
            throw error;
        }
    }

    // ==================== STATISTICS AND REPORTING ====================

    /**
     * Gets comprehensive population statistics
     * @returns {Object} Population statistics
     */
    async getPopulationStats() {
        return await fetchPopulationStats(this.#pool, this.calendarService, this);
    }

    /**
     * Gets all population data including statistics
     * @returns {Object} Complete population data
     */
    async getAllPopulationData() {
        const populations = await this.loadData();
        const stats = await this.getPopulationStats();
        return {
            ...this.getFormattedPopulationData(populations),
            ...stats
        };
    }

    /**
     * Prints a sample of people data for debugging
     * @param {number} limit - Number of records to print
     */
    async printPeopleSample(limit = 10) {
        try {
            const result = await this.#pool.query('SELECT id, sex, date_of_birth FROM people LIMIT $1', [limit]);
            console.log('Sample people table rows:');
            result.rows.forEach(row => console.log(row));
        } catch (err) {
            console.error('Error printing people sample:', err);
        }
    }

    // ==================== COMMUNICATION METHODS ====================

    /**
     * Broadcasts population updates to connected clients
     * @param {string} eventType - Type of event to broadcast
     */
    async broadcastUpdate(eventType = 'populationUpdate') {
        if (this.io) {
            const data = await this.getAllPopulationData();
            this.io.emit(eventType, data);
        }
    }

    /**
     * Updates data and broadcasts changes
     * @param {string} eventType - Type of event to broadcast
     */
    async updateDataAndBroadcast(eventType = 'populationUpdate') {
        await this.saveData();
        await this.broadcastUpdate(eventType);
    }

    // ==================== SERVICE LIFECYCLE METHODS ====================

    /**
     * Starts auto-save functionality
     */
    startAutoSave() {
        startAutoSave(this);
    }

    /**
     * Stops auto-save functionality
     */
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }

    /**
     * Gracefully shuts down the population service
     */
    async shutdown() {
        console.log('🛑 Shutting down population service...');

        this.stopGrowth();
        this.stopAutoSave();
        stopRateTracking(this);

        await this.saveData();
        console.log('💾 Population data saved on shutdown');
    }    /**
     * Tick method for daily updates
     */
    async tick() {
        // Quiet: daily population tick started (log suppressed)

        try {
            // 1. Apply senescence (aging deaths) - runs daily with daily-adjusted probability
            const { applySenescence, processDailyFamilyEvents } = require('./population/lifecycle.js');
            await applySenescence(this.#pool, this.calendarService, this);

            // 2. Form new families from bachelors
            const { formNewFamilies } = require('./population/familyManager.js');
            const newFamilies = await formNewFamilies(this.#pool, this.calendarService);
            if (newFamilies > 0) {
                // Quiet: formed new families on tick (log suppressed)
            }

            // 2. Process births and new pregnancies
            await processDailyFamilyEvents(this.#pool, this.calendarService, this);

            // 3. Broadcast updated population data
            await this.broadcastUpdate('populationUpdate');
        } catch (error) {
            console.error('Error during daily tick:', error);
        }
    }
}

module.exports = new PopulationService();
