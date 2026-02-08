// @ts-check
// Population Service - Main service orchestrator for population management
import config from '../config/server';
import { Server as SocketIOServer } from 'socket.io';

// Event-driven architecture
import populationEvents from '../events/populationEvents';

// Socket communication service
import SocketService from './SocketService';
import CalendarService from './calendarService';

/**
 * @typedef {import('../../types/global').PopulationStats} PopulationStats
 * @typedef {import('../../types/global').TileData} TileData
 * @typedef {import('../../types/global').PersonData} PersonData
 */

// Core modules
import { applySenescence } from './population/lifecycle';
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
    updateTilePopulation,
    resetAllPopulation,
    initializeTilePopulations,
    updateMultipleTilePopulations,
    regeneratePopulationWithNewAgeDistribution
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

// Additional modules for integrity
import { verifyAndRepairIntegrity } from './population/integrity';
import { stopIntegrityAudit } from './population/initializer';

// Rust simulation for family management
import rustSimulation from './rustSimulation';

// Population state (Redis-backed)
import PopulationState from './populationState';

// Statistics service for vital rates tracking
import StatisticsService from './statisticsService';

// Optional metrics module (may not exist) - currently not implemented
const metrics: { auditRunCounter?: { inc: (labels: Record<string, string>) => void }; auditDuration?: { observe: (value: number) => void }; auditFailures?: { inc: () => void }; issuesGauge?: { set: (value: number) => void }; lastRunGauge?: { set: (value: number) => void } } | null = null;

// Type definitions
interface CalendarEventData {
    daysAdvanced: number;
    [key: string]: unknown;
}

interface PopulationData {
    [tileId: string]: number;
}

interface IntegrityDetail {
    tileId: number;
    duplicatesCount?: number;
    missingCount?: number;
    mismatchedCount?: number;
    error?: string;
}

// Event log moved to Rust (Phase 2)
// Node.js now queries Rust event log via rustSimulation.getRecentEvents()
// Keeping type definition for backward compatibility
interface EventLogEntry {
    type: 'birth' | 'death' | 'marriage' | 'pregnancy_started' | 'dissolution';
    date: { year: number; month: number; day: number };
}

/**
 * Population Service
 * Main service orchestrator for population management using Repository Pattern and Event Emitters
 */
class PopulationService {
    #socketService: SocketService;

    io: SocketIOServer;
    calendarService: CalendarService | null;
    events: typeof populationEvents;
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
    eventLog: EventLogEntry[];
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
        this.events = populationEvents;

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

        // Event log moved to Rust (Phase 2) - events automatically logged by Rust tick()
        // Query via rustSimulation.getRecentEvents() when needed
        this.eventLog = []; // Deprecated - kept for backward compatibility

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

    async updatePopulation(tileId: number | string, population: number): Promise<void> {
        await updateTilePopulation(null, this.calendarService, this, tileId, population);
    }
    async resetPopulation(options: Record<string, unknown> = {}) {
        return await resetAllPopulation(null, this, options);
    }
    async initializeTilePopulations(tileIds: number[], options: Record<string, unknown> = {}) {
        return await initializeTilePopulations(null, this.calendarService, this, tileIds, options);
    }
    async updateTilePopulations(tilePopulations: Array<{ tileId: number; population: number }>) {
        // Convert array to object format expected by updateMultipleTilePopulations
        const tilePopulationsObj: Record<string, number> = {};
        for (const { tileId, population } of tilePopulations) {
            tilePopulationsObj[String(tileId)] = population;
        }
        return await updateMultipleTilePopulations(null, this.calendarService, this, tilePopulationsObj);
    }
    async regeneratePopulationWithNewAgeDistribution(): Promise<unknown> {
        return await regeneratePopulationWithNewAgeDistribution(null, this.calendarService, this);
    }

    /**
     * Run integrity check (and optional repair) on demand
     * options: { tiles: Array|null, repair: boolean }
     */
    async runIntegrityCheck(options: { tiles?: number[] | null; repair?: boolean } = {}): Promise<{ success: boolean; details: unknown }> {
        try {
            const { tiles = null, repair = false } = options;
            const start = Date.now();
            if (metrics?.auditRunCounter) metrics.auditRunCounter.inc({ source: 'manual', repair: repair ? 'true' : 'false' });
            const res = await verifyAndRepairIntegrity(null, tiles, {}, { repair });
            const durationSec = (Date.now() - start) / 1000;
            if (metrics && metrics.auditDuration) metrics.auditDuration.observe(durationSec);
            if (!res.ok) {
                if (metrics && metrics.auditFailures) metrics.auditFailures.inc();
                const details = res.details as IntegrityDetail[];
                const issuesCount = Array.isArray(details) ? details.reduce((sum: number, d: IntegrityDetail) => sum + (d.duplicatesCount || d.missingCount || d.mismatchedCount || 0), 0) : 0;
                if (metrics && metrics.issuesGauge) metrics.issuesGauge.set(issuesCount);
            } else {
                if (metrics && metrics.issuesGauge) metrics.issuesGauge.set(0);
            }
            if (metrics && metrics.lastRunGauge) metrics.lastRunGauge.set(Date.now() / 1000);
            return { success: res.ok, details: res.details };
        } catch (err: unknown) {
            console.error('Error running integrity check:', err);
            throw err;
        }
    }

    startGrowth() { startGrowth(this); }
    stopGrowth() { stopGrowth(this); }
    async updateGrowthRate(rate: number) { return await updateGrowthRate(this, rate); }

    async applySenescenceManually() {
        const deaths = await applySenescence(null, this.calendarService, this);
        if (deaths > 0) await this.broadcastUpdate('senescenceApplied');
        const populations = await this.loadData();
        return {
            success: true,
            deaths,
            message: `Senescence applied: ${deaths} people died of old age`,
            data: this.getFormattedPopulationData(populations)
        };
    }

    async createFamiliesForExistingPopulation() {
        // This method is deprecated - Rust simulation handles family creation automatically
        console.warn('⚠️ createFamiliesForExistingPopulation is deprecated - Rust simulation handles family creation');

        const populations = await this.loadData();
        return {
            success: true,
            familiesCreated: 0,
            message: 'Family creation is now handled by Rust simulation',
            data: this.getFormattedPopulationData(populations)
        };
    }

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

    /**
     * Tick method - DEPRECATED
     * Ticks are now fully handled by Rust calendar thread automatically.
     * This method is kept for manual tick testing only.
     * @param daysAdvanced - Number of days that passed in this tick (default 1)
     */
    async tick(daysAdvanced = 1) {
        console.warn('⚠️ PopulationService.tick() called manually - ticks are now automatic via Rust calendar thread');

        try {
            // Execute tick in Rust simulation (handles births, deaths, marriages, pregnancies, dissolutions)
            const result = daysAdvanced === 1
                ? rustSimulation.tick()
                : rustSimulation.tickMany(daysAdvanced);

            // Track births and deaths for statistics
            if (result.births > 0) {
                this.trackBirths(result.births);
            }
            if (result.deaths > 0) {
                this.trackDeaths(result.deaths);
            }

            // Events are automatically logged by Rust tick() (Phase 2)
            // No need to push to eventLog - query via rustSimulation.getRecentEvents() when needed

            // Log significant events
            if (config.verboseLogs && (result.births > 0 || result.deaths > 0 || result.marriages > 0)) {
                console.log(`🦀 Rust tick: ${result.births} births, ${result.deaths} deaths, ${result.marriages} marriages, pop=${result.population}`);
            }

            // Broadcast updated population data
            await this.broadcastUpdate('populationUpdate');
        } catch (error: unknown) {
            console.error('Error during tick:', error);
        }
    }
}

export default PopulationService;
