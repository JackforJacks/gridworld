// Population Service - Main service orchestrator for population management
const pool = require('../config/database.js');
const config = require('../config/server.js');

// Repository Pattern for data access
const PopulationRepository = require('../repositories/PopulationRepository');

// Event-driven architecture
const populationEvents = require('../events/populationEvents');

// Socket communication service
const SocketService = require('./SocketService');

// Core modules
const { applySenescence } = require('./population/lifecycle.js');
const {
    stopRateTracking,
    trackBirths,
    trackDeaths,
    startRateTracking,
    resetRateCounters
} = require('./population/PopStats.js');

// Service modules
const {
    initializePopulationService,
    startAutoSave
} = require('./population/initializer.js');
const {
    fetchPopulationStats,
    getPopulationStats,
    getAllPopulationData,
    printPeopleSample
} = require('./population/PopStats.js');

// New modular components
const {
    loadPopulationData,
    savePopulationData,
    formatPopulationData
} = require('./population/dataOperations.js');

const {
    updateTilePopulation,
    resetAllPopulation,
    initializeTilePopulations,
    updateMultipleTilePopulations,
    regeneratePopulationWithNewAgeDistribution
} = require('./population/operations.js');

const {
    startGrowth,
    stopGrowth,
    updateGrowthRate
} = require('./population/lifecycle.js');

const {
    broadcastUpdate,
    updateDataAndBroadcast,
    setupRealtimeListeners
} = require('./population/communication.js');

const { validateTileIds } = require('./population/validation.js');

// Statistics service for vital rates tracking
const StatisticsService = require('./statisticsService');

class PopulationService {
    #pool;
    #repository;
    #socketService;

    constructor(io, calendarService = null, statisticsService = null) {
        // Direct dependencies
        this.io = io;
        this.calendarService = calendarService;
        this.#pool = pool;

        // Repository for data access (implements Repository Pattern)
        this.#repository = new PopulationRepository(pool);

        // Socket service for communication (decouples socket logic)
        this.#socketService = new SocketService(io);
        this.#socketService.initialize();

        // Event emitter for decoupled event handling
        this.events = populationEvents;

        // Service state
        this.growthInterval = null;
        this.autoSaveInterval = null;
        this.rateInterval = null;
        this.isGrowthEnabled = false;
        this.batchUpdateThreshold = config.populationBatchSize || 100;
        this.rateTrackingInterval = config.rateTrackingInterval || 60000;
        this.birthCount = 0;
        this.deathCount = 0;
        this.lastRateReset = Date.now();

        // In-memory event log for births and deaths
        this.eventLog = [];

        // Statistics service for vital rates - use provided instance or create new one
        this.statisticsService = statisticsService || new StatisticsService();

        // Setup event listeners
        this._setupEventListeners();
    }

    /**
     * Setup internal event listeners
     * Decouples event handling from direct method calls
     * @private
     */
    _setupEventListeners() {
        // Listen to birth events and broadcast via socket
        this.events.onBirth((data) => {
            this.#socketService.emitBirth(data);
            this.birthCount++;
        });

        // Listen to death events and broadcast via socket
        this.events.onDeath((data) => {
            this.#socketService.emitDeath(data);
            this.deathCount++;
        });

        // Listen to family created events
        this.events.onFamilyCreated((data) => {
            this.#socketService.emitFamilyCreated(data);
        });

        // Listen to population updates
        this.events.onPopulationUpdated((data) => {
            this.#socketService.emitPopulationUpdate(data);
        });

        // Listen to save completed events
        this.events.onSaveCompleted((data) => {
            this.#socketService.emitGameSaved(data);
        });
    }

    /**
     * Get repository instance (for testing/advanced use)
     * @returns {PopulationRepository}
     */
    getRepository() {
        return this.#repository;
    }

    /**
     * Get socket service instance
     * @returns {SocketService}
     */
    getSocketService() {
        return this.#socketService;
    }

    getPool() { return this.#pool; }

    getStatisticsService() {
        return this.statisticsService;
    } async initialize(io, calendarService = null) {
        await initializePopulationService(this, io, calendarService);
        setupRealtimeListeners(io, this);
        // Initialize rate tracking
        resetRateCounters(this);
        startRateTracking(this);
        // Initialize statistics service with calendar (only if not already initialized)
        if (!this.statisticsService.isTracking) {
            this.statisticsService.initialize(calendarService);
        }

        // Listen to calendar tick events for daily population updates
        if (calendarService) {
            calendarService.on('tick', async (eventData) => {
                // Process tick with the number of days advanced (not looping)
                if (eventData.daysAdvanced > 0) {
                    await this.tick(eventData.daysAdvanced);
                }
            });
            if (config.verboseLogs) console.log('📅 Population service listening to calendar tick events');
        }
    }

    async loadData() { return await loadPopulationData(this.#pool); }
    async saveData() { return await savePopulationData(); }
    async getPopulations() { return await this.loadData(); }
    getFormattedPopulationData(populations = null) { return formatPopulationData(populations); }

    async updatePopulation(tileId, population) {
        await updateTilePopulation(this.#pool, this.calendarService, this, tileId, population);
    }
    async resetPopulation(options = {}) {
        return await resetAllPopulation(this.#pool, this, options);
    }
    async initializeTilePopulations(tileIds, options = {}) {
        return await initializeTilePopulations(this.#pool, this.calendarService, this, tileIds, options);
    }
    async updateTilePopulations(tilePopulations) {
        return await updateMultipleTilePopulations(this.#pool, this.calendarService, this, tilePopulations);
    }
    async regeneratePopulationWithNewAgeDistribution() {
        return await regeneratePopulationWithNewAgeDistribution(this.#pool, this.calendarService, this);
    }

    /**
     * Run integrity check (and optional repair) on demand
     * options: { tiles: Array|null, repair: boolean }
     */
    async runIntegrityCheck(options = {}) {
        try {
            const { tiles = null, repair = false } = options;
            const integrity = require('./population/integrity');
            let metrics; try { metrics = require('./metrics'); } catch (_) { metrics = null; }
            const start = Date.now();
            if (metrics && metrics.auditRunCounter) metrics.auditRunCounter.inc({ source: 'manual', repair: repair ? 'true' : 'false' });
            const res = await integrity.verifyAndRepairIntegrity(this.#pool, tiles, {}, { repair });
            const durationSec = (Date.now() - start) / 1000;
            if (metrics && metrics.auditDuration) metrics.auditDuration.observe(durationSec);
            if (!res.ok) {
                if (metrics && metrics.auditFailures) metrics.auditFailures.inc();
                const issuesCount = Array.isArray(res.details) ? res.details.reduce((sum, d) => sum + (d.duplicatesCount || d.missingCount || d.mismatchedCount || 0), 0) : 0;
                if (metrics && metrics.issuesGauge) metrics.issuesGauge.set(issuesCount);
            } else {
                if (metrics && metrics.issuesGauge) metrics.issuesGauge.set(0);
            }
            if (metrics && metrics.lastRunGauge) metrics.lastRunGauge.set(Date.now() / 1000);
            return { success: res.ok, details: res.details };
        } catch (err) {
            console.error('Error running integrity check:', err);
            throw err;
        }
    }

    startGrowth() { startGrowth(this); }
    stopGrowth() { stopGrowth(this); }
    async updateGrowthRate(rate) { return await updateGrowthRate(this, rate); } async applySenescenceManually() {
        try {
            const deaths = await applySenescence(this.#pool, this.calendarService, this);
            if (deaths > 0) await this.broadcastUpdate('senescenceApplied');
            const populations = await this.loadData();
            return {
                success: true,
                deaths,
                message: `Senescence applied: ${deaths} people died of old age`,
                data: this.getFormattedPopulationData(populations)
            };
        } catch (error) {
            throw error;
        }
    } async createFamiliesForExistingPopulation() {
        try {
            const { createRandomFamilies } = require('./population/family.js');

            // Use repository to get tiles with population
            const tilePopulations = await this.#repository.getTilePopulations();
            const tileIds = tilePopulations.map(tp => tp.tile_id);

            let totalFamiliesCreated = 0;
            for (const tileId of tileIds) {
                const beforeFamilies = await this.#repository.getAllFamilies({ tileId });
                const beforeCount = beforeFamilies.length;

                await createRandomFamilies(this.#pool, tileId, this.calendarService);

                const afterFamilies = await this.#repository.getAllFamilies({ tileId });
                const afterCount = afterFamilies.length;

                const newFamilies = afterCount - beforeCount;
                totalFamiliesCreated += newFamilies;

                if (newFamilies > 0) {
                    if (config.verboseLogs) console.log(`🏠 Created ${newFamilies} new families on tile ${tileId}`);
                    // Emit family created events
                    for (let i = 0; i < newFamilies; i++) {
                        this.events.emitFamilyCreated({ tileId });
                    }
                }
            }

            if (totalFamiliesCreated > 0) {
                await this.broadcastUpdate('familiesCreated');
            }

            const populations = await this.loadData();
            return {
                success: true,
                familiesCreated: totalFamiliesCreated,
                message: `Created ${totalFamiliesCreated} new families across ${tileIds.length} tiles`,
                data: this.getFormattedPopulationData(populations)
            };
        } catch (error) {
            console.error('Error creating families for existing population:', error);
            throw error;
        }
    }

    // Statistics and reporting: delegate directly to PopStats.js
    async getPopulationStats() {
        return await getPopulationStats(this.#pool, this.calendarService, this);
    }
    async getAllPopulationData() {
        return await getAllPopulationData(this.#pool, this.calendarService, this);
    } async printPeopleSample(limit = 10) {
        await printPeopleSample(this.#pool, limit);
    }

    // Rate tracking methods

    /**
     * Track births with in-game date
     * Uses event emitter for decoupled notification
     * @param {number} count - Number of births
     */
    trackBirths(count) {
        if (!this.calendarService) return;
        const date = this.calendarService.getCurrentDate();

        for (let i = 0; i < count; i++) {
            this.eventLog.push({ type: 'birth', date: { ...date } });
            // Emit birth event instead of direct socket call
            this.events.emitBirth({ date, count: 1 });
        }

        // Record in statistics service asynchronously
        if (this.statisticsService) {
            (async () => {
                try {
                    const stats = await this.getPopulationStats();
                    const totalPop = stats?.totalPopulation || 0;
                    for (let i = 0; i < count; i++) {
                        this.statisticsService.recordBirth(totalPop);
                    }
                } catch (err) {
                    console.error('Error recording births in statistics:', err);
                }
            })();
        }
    }

    /**
     * Track deaths with in-game date
     * Uses event emitter for decoupled notification
     * @param {number} count - Number of deaths
     */
    trackDeaths(count) {
        if (!this.calendarService) return;
        const date = this.calendarService.getCurrentDate();

        for (let i = 0; i < count; i++) {
            this.eventLog.push({ type: 'death', date: { ...date } });
            // Emit death event instead of direct socket call
            this.events.emitDeath({ date, count: 1 });
        }

        // Record in statistics service asynchronously
        if (this.statisticsService) {
            (async () => {
                try {
                    const stats = await this.getPopulationStats();
                    const totalPop = stats?.totalPopulation || 0;
                    for (let i = 0; i < count; i++) {
                        this.statisticsService.recordDeath(totalPop);
                    }
                } catch (err) {
                    console.error('Error recording deaths in statistics:', err);
                }
            })();
        }
    }

    // Communication
    async broadcastUpdate(eventType = 'populationUpdate') {
        await broadcastUpdate(this.io, () => this.getAllPopulationData(), eventType);
    }
    async updateDataAndBroadcast(eventType = 'populationUpdate') {
        await updateDataAndBroadcast(
            this.io,
            () => this.saveData(),
            () => this.getAllPopulationData(),
            eventType
        );
    }

    // Service lifecycle
    startAutoSave() { startAutoSave(this); }
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    } async shutdown() {
        this.stopGrowth();
        this.stopAutoSave();
        // Stop scheduled integrity audit if running
        try {
            const { stopIntegrityAudit } = require('./population/initializer');
            stopIntegrityAudit(this);
        } catch (_) { }
        stopRateTracking(this);
        // Shutdown statistics service
        if (this.statisticsService) {
            this.statisticsService.shutdown();
        }
        await this.saveData();
    }

    /**
     * Tick method for population updates - processes births, deaths (senescence), and family formation
     * @param {number} daysAdvanced - Number of days that passed in this tick (default 1)
     */
    async tick(daysAdvanced = 1) {
        // Quiet: population tick started (log suppressed)

        try {
            // 1. Apply senescence (aging deaths) - probability adjusted for days passed
            const { applySenescence, processDailyFamilyEvents } = require('./population/lifecycle.js');
            await applySenescence(this.#pool, this.calendarService, this, daysAdvanced);

            // 2. Form new families from bachelors (run once per tick, families form over time)
            const { formNewFamilies } = require('./population/familyManager.js');
            const newFamilies = await formNewFamilies(this.#pool, this.calendarService);
            if (newFamilies > 0) {
                // Quiet: formed new families on tick (log suppressed)
            }

            // 3. Process births and new pregnancies (adjusted for days passed)
            await processDailyFamilyEvents(this.#pool, this.calendarService, this, daysAdvanced);

            // 4. Broadcast updated population data
            await this.broadcastUpdate('populationUpdate');
        } catch (error) {
            console.error('Error during tick:', error);
        }
    }
}

module.exports = PopulationService;
