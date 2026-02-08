// @ts-check
// Population Service - Main service orchestrator for population management
import config from '../config/server';
import { Server as SocketIOServer } from 'socket.io';
import { EventEmitter } from 'events';

// Socket communication service
import SocketService from './SocketService';
import CalendarService from './calendarService';

/**
 * @typedef {import('../../types/global').PopulationStats} PopulationStats
 * @typedef {import('../../types/global').TileData} TileData
 * @typedef {import('../../types/global').PersonData} PersonData
 */

import {
    stopRateTracking,
    startRateTracking,
    resetRateCounters
} from './population/PopStats';

// Service modules
import {
    initializePopulationService,
    startAutoSave
} from './population/initializer';
import {
    getPopulationStats,
    getAllPopulationData,
    printPeopleSample
} from './population/PopStats';

// New modular components
import {
    loadPopulationData,
    savePopulationData,
    formatPopulationData
} from './population/dataOperations';

import {
    formatPopData,
    loadPopData
} from './population/operations';

import {
    startGrowth,
    stopGrowth,
    updateGrowthRate
} from './population/lifecycle';

import {
    broadcastUpdate,
    updateDataAndBroadcast,
    setupRealtimeListeners
} from './population/communication';

import { stopIntegrityAudit } from './population/initializer';

import rustSimulation from './rustSimulation';
import StatisticsService from './statisticsService';

interface PopulationData {
    [tileId: string]: number;
}

/**
 * Population Service
 * Main service orchestrator for population management using Repository Pattern and Event Emitters
 */
class PopulationService {
    #socketService: SocketService;

    io: SocketIOServer;
    calendarService: CalendarService | null;
    events: EventEmitter;
    growthInterval: ReturnType<typeof setInterval> | null;
    autoSaveInterval: ReturnType<typeof setInterval> | null;
    rateInterval: ReturnType<typeof setInterval> | null;
    isGrowthEnabled: boolean;
    batchUpdateThreshold: number;
    rateTrackingInterval: number;
    birthCount: number;
    deathCount: number;
    totalBirthCount: number;
    totalDeathCount: number;
    lastRateReset: number;
    statisticsService: StatisticsService;

    /**
     * Create a population service
     * @param io - Socket.IO instance
     * @param calendarService - Calendar service instance
     * @param statisticsService - Statistics service instance
     */
    constructor(io: SocketIOServer, calendarService: CalendarService | null = null, statisticsService: StatisticsService | null = null) {
        // Direct dependencies
        this.io = io;
        this.calendarService = calendarService;

        // Socket service for communication (decouples socket logic)
        this.#socketService = new SocketService(io);
        this.#socketService.initialize();

        // Event emitter for decoupled event handling
        this.events = new EventEmitter();

        // Service state
        this.growthInterval = null;
        this.autoSaveInterval = null;
        this.rateInterval = null;
        this.isGrowthEnabled = false;
        this.batchUpdateThreshold = config.populationBatchSize || 100;
        this.rateTrackingInterval = 60000; // 60 seconds default
        this.birthCount = 0;
        this.deathCount = 0;
        this.totalBirthCount = 0;
        this.totalDeathCount = 0;
        this.lastRateReset = Date.now();

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
        this.events.on('birth', (data) => {
            this.#socketService.emitBirth(data);
            this.birthCount++;
        });

        this.events.on('death', (data) => {
            this.#socketService.emitDeath(data);
            this.deathCount++;
        });

        this.events.on('familyCreated', (data) => {
            this.#socketService.emitFamilyCreated(data);
        });

        this.events.on('populationUpdated', (data) => {
            this.#socketService.emitPopulationUpdate(data);
        });

        this.events.on('saveCompleted', (data) => {
            this.#socketService.emitGameSaved(data);
        });
    }

    /**
     * Get socket service instance
     * @returns {SocketService}
     */
    getSocketService() {
        return this.#socketService;
    }

    getStatisticsService(): StatisticsService {
        return this.statisticsService;
    }

    async initialize(io: SocketIOServer, calendarService: CalendarService | null = null): Promise<void> {
        await initializePopulationService(this, io, calendarService);
        setupRealtimeListeners(io, this);
        // Initialize rate tracking
        resetRateCounters(this);
        startRateTracking(this);
        // Initialize statistics service with calendar (only if not already initialized)
        if (!this.statisticsService.isTracking) {
            this.statisticsService.initialize(calendarService);
        }

        // Listen to calendar tick events for statistics tracking
        // Rust now handles the actual tick AND event logging (Phase 2)
        if (calendarService) {
            calendarService.on('tick', async (eventData: any) => {
                // Event data now includes tickResults from Rust calendar thread
                if (eventData.tickResults) {
                    const { births, deaths } = eventData.tickResults;

                    // Track births and deaths for statistics (Node.js side)
                    if (births > 0) this.trackBirths(births);
                    if (deaths > 0) this.trackDeaths(deaths);

                    // Events are automatically logged by Rust tick() - no need to push to eventLog
                    // Query via rustSimulation.getRecentEvents() when needed

                    // Broadcast updated population data
                    await this.broadcastUpdate('populationUpdate');
                }
            });
            if (config.verboseLogs) console.log('📅 Population service listening to Rust calendar tick events');
        }
    }

    async loadData(): Promise<PopulationData> { return await loadPopulationData(null); }
    async saveData(): Promise<void> { return await savePopulationData(); }
    async getPopulations(): Promise<PopulationData> { return await this.loadData(); }
    getFormattedPopulationData(populations: PopulationData | null = null): unknown { return formatPopulationData(populations); }

    async updatePopulation(_tileId: number | string, _population: number): Promise<void> {
        console.warn('updatePopulation deprecated - Rust ECS manages tile populations');
    }
    async resetPopulation(_options: Record<string, unknown> = {}) {
        console.warn('resetPopulation deprecated - use /api/worldrestart instead');
        return formatPopData();
    }
    async initializeTilePopulations(_tileIds: number[], _options: Record<string, unknown> = {}) {
        console.warn('initializeTilePopulations deprecated - use /api/worldrestart instead');
        return formatPopData();
    }
    async updateTilePopulations(_tilePopulations: Array<{ tileId: number; population: number }>) {
        console.warn('updateTilePopulations deprecated - Rust ECS manages tile populations');
        return formatPopData();
    }
    async regeneratePopulationWithNewAgeDistribution(): Promise<unknown> {
        console.warn('regeneratePopulationWithNewAgeDistribution deprecated - use /api/worldrestart instead');
        return formatPopData();
    }

    startGrowth() { startGrowth(this); }
    stopGrowth() { stopGrowth(this); }
    async updateGrowthRate(rate: number) { return await updateGrowthRate(this, rate); }

    // Statistics and reporting: delegate directly to PopStats
    async getPopulationStats() {
        return await getPopulationStats(null, this.calendarService, this);
    }
    async getAllPopulationData() {
        return await getAllPopulationData(null, this.calendarService, this);
    } async printPeopleSample(limit = 10) {
        await printPeopleSample(null, limit);
    }

    // Rate tracking methods

    /**
     * Track births with in-game date
     * Uses event emitter for decoupled notification
     * Note: Events are now logged by Rust automatically (Phase 2)
     * @param count - Number of births
     */
    trackBirths(count: number) {
        if (!this.calendarService) return;
        const date = this.calendarService.getCurrentDate();

        // Increment birth counter for rate calculations (resets periodically)
        this.birthCount += count;
        // Increment cumulative birth counter (never resets)
        this.totalBirthCount += count;

        // Emit birth events for WebSocket broadcasting
        for (let i = 0; i < count; i++) {
            this.events.emit('birth', { date, count: 1 });
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
                } catch (err: unknown) {
                    console.error('Error recording births in statistics:', err);
                }
            })();
        }
    }

    /**
     * Track deaths with in-game date
     * Uses event emitter for decoupled notification
     * Note: Events are now logged by Rust automatically (Phase 2)
     * @param count - Number of deaths
     */
    trackDeaths(count: number) {
        if (!this.calendarService) return;
        const date = this.calendarService.getCurrentDate();

        // Increment death counter for rate calculations (resets periodically)
        this.deathCount += count;
        // Increment cumulative death counter (never resets)
        this.totalDeathCount += count;

        // Emit death events for WebSocket broadcasting
        for (let i = 0; i < count; i++) {
            this.events.emit('death', { date, count: 1 });
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
                } catch (err: unknown) {
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
    }

    async shutdown() {
        this.stopGrowth();
        this.stopAutoSave();
        // Stop scheduled integrity audit if running
        stopIntegrityAudit(this);
        stopRateTracking(this);
        // Shutdown statistics service
        if (this.statisticsService) {
            this.statisticsService.shutdown();
        }
        await this.saveData();
    }

}

export default PopulationService;
