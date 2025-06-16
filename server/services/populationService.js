// Population Service - Main service orchestrator for population management
const pool = require('../config/database.js');
const config = require('../config/server.js');

// Core modules
const { applySenescence } = require('./population/lifecycle.js');
const { stopRateTracking } = require('./population/PopStats.js');

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

class PopulationService {
    #pool;

    constructor(io, calendarService = null) {
        this.io = io;
        this.calendarService = calendarService;
        this.#pool = pool;
        this.growthInterval = null;
        this.autoSaveInterval = null;
        this.rateInterval = null;
        this.isGrowthEnabled = false;
        this.batchUpdateThreshold = config.populationBatchSize || 100;
        this.rateTrackingInterval = config.rateTrackingInterval || 60000;
        this.birthCount = 0;
        this.deathCount = 0;
        this.lastRateReset = Date.now();
    }

    getPool() { return this.#pool; }

    async initialize(io, calendarService = null) {
        await initializePopulationService(this, io, calendarService);
        setupRealtimeListeners(io, this);
    }

    async loadData() { return await loadPopulationData(this.#pool); }
    async saveData() { return await savePopulationData(); }
    async getPopulations() { return await this.loadData(); }
    getFormattedPopulationData(populations = null) { return formatPopulationData(populations); }

    async updatePopulation(tileId, population) {
        await updateTilePopulation(this.#pool, this.calendarService, this, tileId, population);
    }
    async resetPopulation() { return await resetAllPopulation(this.#pool, this); }
    async initializeTilePopulations(tileIds) {
        return await initializeTilePopulations(this.#pool, this.calendarService, this, tileIds);
    }
    async updateTilePopulations(tilePopulations) {
        return await updateMultipleTilePopulations(this.#pool, this.calendarService, this, tilePopulations);
    }
    async regeneratePopulationWithNewAgeDistribution() {
        return await regeneratePopulationWithNewAgeDistribution(this.#pool, this.calendarService, this);
    }

    startGrowth() { startGrowth(this); }
    stopGrowth() { stopGrowth(this); }
    async updateGrowthRate(rate) { return await updateGrowthRate(this, rate); }

    async applySenescenceManually() {
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
    }

    // Statistics and reporting: delegate directly to PopStats.js
    async getPopulationStats() {
        return await getPopulationStats(this.#pool, this.calendarService, this);
    }
    async getAllPopulationData() {
        return await getAllPopulationData(this.#pool, this.calendarService, this);
    }
    async printPeopleSample(limit = 10) {
        await printPeopleSample(this.#pool, limit);
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
    }
    async shutdown() {
        this.stopGrowth();
        this.stopAutoSave();
        stopRateTracking(this);
        await this.saveData();
    }
}

module.exports = new PopulationService();
