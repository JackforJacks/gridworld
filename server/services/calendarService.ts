import EventEmitter from 'events';
import calendarConfig from '../config/calendar';
import serverConfig from '../config/server';
import rustSimulation from './rustSimulation';

interface SpeedMode {
    name: string;
    daysPerTick: number;
    description: string;
    populationUpdatesPerTick: number;
    intervalMs: number;
}

interface SpeedModes {
    [key: string]: SpeedMode;
}

interface CalendarState {
    isRunning: boolean;
    totalDays: number;
    totalTicks: number;
    startTime: number | null;
    lastTickTime: number | null;
}

interface CurrentDate {
    day: number;
    month: number;
    year: number;
}

interface InternalConfig {
    daysPerMonth: number;
    monthsPerYear: number;
    startDay: number;
    startMonth: number;
    startYear: number;
    defaultSpeed: string;
    autoStart: boolean;
    realTimeTickMs: number;
    [key: string]: any;
}

/**
 * Calendar Service - Timer and event broadcaster for Rust ECS calendar
 *
 * This service is a thin wrapper around the Rust ECS calendar system.
 * It provides:
 * - Tick timer management (start/stop/speed control)
 * - Event broadcasting to Node.js listeners
 * - Socket.io integration for client updates
 *
 * Calendar state (year/month/day) is stored exclusively in Rust ECS.
 * Calendar advances happen in `rustSimulation.tick()` (called by PopulationService).
 */
class CalendarService extends EventEmitter {
    io: any;
    config: typeof calendarConfig;
    speedModes: SpeedModes;
    currentSpeed: string;
    state: CalendarState;
    tickTimer: ReturnType<typeof setInterval> | null;
    subscribers: Set<(event: string, data: any) => void>;
    internalConfig: InternalConfig;
    _initialized: boolean;

    constructor(io: any = null) {
        super();

        this.io = io;
        this.config = calendarConfig;

        // Speed modes: daily (1 day/sec) and monthly (1 month/sec via faster ticks)
        // Monthly runs 8 individual daily ticks at 125ms intervals (8 × 125ms = 1000ms)
        this.speedModes = {
            '1_day': {
                name: '1 Day/sec',
                daysPerTick: 1,
                description: 'Advance 1 day every second',
                populationUpdatesPerTick: 1,
                intervalMs: 1000
            },
            '1_month': {
                name: '1 Month/sec',
                daysPerTick: 1,
                description: 'Advance 1 month every second (8 daily ticks at 125ms)',
                populationUpdatesPerTick: 1,
                intervalMs: Math.floor(1000 / this.config.daysPerMonth) // 125ms for 8 days/month
            }
        };

        this.currentSpeed = this.speedModes[this.config.defaultSpeed] ? this.config.defaultSpeed : '1_day';

        // Calendar state (tick tracking only - calendar date comes from Rust)
        this.state = {
            isRunning: false,
            totalDays: 0,
            totalTicks: 0,
            startTime: null,
            lastTickTime: null
        };

        // Tick management
        this.tickTimer = null;
        this.subscribers = new Set();

        // Internal config
        this.internalConfig = {
            ...this.config,
            realTimeTickMs: parseInt(process.env.CALENDAR_TICK_INTERVAL_MS || '1000') || 1000
        };

        this._initialized = false;
    }

    /**
     * Async initialization - must be awaited before using the service
     */
    async initialize() {
        if (this._initialized) return;

        // Sync totalDays from Rust calendar
        try {
            const rustCal = rustSimulation.getCalendar();
            if (rustCal) {
                this.state.totalDays = rustCal.year * 96 + rustCal.month * 8 + rustCal.day; // Approximate
                if (serverConfig.verboseLogs) {
                    console.log(`📅 Calendar synced from Rust: Y${rustCal.year} M${rustCal.month} D${rustCal.day}`);
                }
            }
        } catch (e) {
            if (serverConfig.verboseLogs) console.warn('📅 Could not sync from Rust calendar');
        }

        this._initialized = true;

        if (serverConfig.verboseLogs) {
            console.log('📅 Calendar Service initialized:', {
                daysPerMonth: this.internalConfig.daysPerMonth,
                monthsPerYear: this.internalConfig.monthsPerYear,
                currentSpeed: this.speedModes[this.currentSpeed].name,
                startDate: this.getFormattedDate()
            });
        }

        // Auto-start calendar in non-test environments
        if (this.internalConfig.autoStart && process.env.NODE_ENV !== 'test') {
            this.start();
        }
    }

    /**
     * Start the calendar ticking system at the current speed mode's interval
     */
    start() {
        if (this.state.isRunning) {
            if (serverConfig.verboseLogs) console.log('⚠️ Calendar is already running');
            return false;
        }

        this.state.isRunning = true;
        this.state.startTime = this.state.startTime || Date.now();
        this.state.lastTickTime = Date.now();

        const intervalMs = this.speedModes[this.currentSpeed].intervalMs;
        this.tickTimer = setInterval(() => {
            this.tick();
        }, intervalMs);
        if (serverConfig.verboseLogs) {
            console.log(`🟢 Calendar started - ${this.speedModes[this.currentSpeed].name} (${intervalMs}ms intervals)`);
        }

        const stateData = this.getState();
        this.emit('started', stateData);

        // Broadcast to all socket clients
        if (this.io) {
            this.io.emit('calendarStarted', stateData);
            this.io.emit('calendarState', stateData);
        }

        return true;
    }

    /**
     * Stop the calendar ticking system
     */
    stop() {
        if (!this.state.isRunning) {
            if (serverConfig.verboseLogs) console.log('⚠️ Calendar is already stopped');
            return false;
        }

        this.state.isRunning = false;

        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        if (serverConfig.verboseLogs) console.log('🔴 Calendar stopped');

        const stateData = this.getState();
        this.emit('stopped', stateData);

        // Broadcast to all socket clients
        if (this.io) {
            this.io.emit('calendarStopped', stateData);
            this.io.emit('calendarState', stateData);
        }

        return true;
    }

    /**
     * Reset the calendar to initial state
     * Note: Does NOT reset Rust calendar - call rustSimulation.reset() separately
     */
    reset() {
        const wasRunning = this.state.isRunning;

        this.stop();

        this.state = {
            isRunning: false,
            totalDays: 0,
            totalTicks: 0,
            startTime: null,
            lastTickTime: null
        };

        this.currentSpeed = this.config.defaultSpeed;

        if (serverConfig.verboseLogs) console.log('🔄 Calendar service reset');
        this.emit('reset', this.getState());

        if (wasRunning && this.config.autoStart) {
            this.start();
        }

        return true;
    }

    /**
     * Tick handler - fires at speed-dependent intervals
     * Emits 'tick' event that triggers PopulationService.tick() → rustSimulation.tick()
     */
    async tick(): Promise<void> {
        if (!this.state.isRunning) {
            return;
        }

        this.state.totalTicks++;
        this.state.lastTickTime = Date.now();
        this.state.totalDays++; // Approximate tracking

        // Get current date from Rust (after PopulationService.tick() will advance it)
        const previousDate = this.getCurrentDate();

        // Prepare event data (PopulationService will handle actual Rust tick)
        const eventData = {
            previousDate,
            currentDate: this.getCurrentDate(), // Still previous, will be advanced by PopulationService
            daysAdvanced: 1,
            speedMode: this.speedModes[this.currentSpeed].name,
            totalTicks: this.state.totalTicks,
            totalDaysAdvanced: this.state.totalDays,
            eventsTriggered: [], // Events computed after Rust tick in PopulationService
            populationUpdates: 1,
            state: this.getState()
        };

        // Emit tick event - PopulationService listens and calls rustSimulation.tick()
        this.emit('tick', eventData);

        // Broadcast to all socket clients
        if (this.io) {
            this.io.emit('calendarTick', eventData);
            this.io.emit('calendarState', this.getState());
        }
    }

    /**
     * Change the calendar speed
     */
    setSpeed(speedKey: string): boolean {
        if (!this.speedModes[speedKey]) {
            throw new Error(`Invalid speed: ${speedKey}. Available speeds: ${Object.keys(this.speedModes).join(', ')}`);
        }

        const oldSpeed = this.currentSpeed;
        this.currentSpeed = speedKey;

        // Restart timer with new interval if running
        if (this.state.isRunning && this.tickTimer) {
            clearInterval(this.tickTimer);
            const intervalMs = this.speedModes[speedKey].intervalMs;
            this.tickTimer = setInterval(() => {
                this.tick();
            }, intervalMs);
            if (serverConfig.verboseLogs) {
                console.log(`⚡ Speed changed: ${this.speedModes[oldSpeed].name} → ${this.speedModes[speedKey].name} (${intervalMs}ms intervals)`);
            }
        } else {
            if (serverConfig.verboseLogs) {
                console.log(`⚡ Speed changed: ${this.speedModes[oldSpeed].name} → ${this.speedModes[speedKey].name}`);
            }
        }

        this.emit('speedChanged', {
            oldSpeed: this.speedModes[oldSpeed],
            newSpeed: this.speedModes[speedKey],
            currentSpeed: speedKey
        });

        return true;
    }

    /**
     * Set a specific date - NOT SUPPORTED (Rust calendar is advanced by tick only)
     * Left as stub for API compatibility
     */
    async setDate(_day: number, _month: number, _year: number): Promise<boolean> {
        console.warn('⚠️ CalendarService.setDate() is deprecated - calendar is managed by Rust ECS');
        return false;
    }

    /**
     * Get current calendar state
     */
    getState() {
        const currentDate = this.getCurrentDate();
        return {
            currentDate,
            isPaused: !this.state.isRunning,
            simulationTime: this.state.totalDays,
            config: this.internalConfig,
            currentSpeed: this.currentSpeed,
            speedModeDetails: this.speedModes[this.currentSpeed],
            totalTicks: this.state.totalTicks
        };
    }

    /**
     * Gets the current calendar date from Rust ECS (source of truth)
     * @returns {Object} Calendar date object with year, month, day
     */
    getCurrentDate(): CurrentDate {
        try {
            const rustCal = rustSimulation.getCalendar();
            if (rustCal) {
                return {
                    year: rustCal.year,
                    month: rustCal.month,
                    day: rustCal.day
                };
            }
        } catch (e) {
            // Rust not initialized, return default
        }

        // Fallback to config defaults
        return {
            year: this.config.startYear || 4000,
            month: this.config.startMonth || 1,
            day: this.config.startDay || 1
        };
    }

    /**
     * Get statistics about calendar usage
     */
    getStats(): any {
        const currentTime = Date.now();
        const uptime = this.state.startTime ? currentTime - this.state.startTime : 0;
        const avgDaysPerSecond = this.state.totalDays / Math.max(1, uptime / 1000);
        const expectedTicks = Math.floor(uptime / this.internalConfig.realTimeTickMs);

        return {
            totalTicks: this.state.totalTicks,
            totalDaysAdvanced: this.state.totalDays,
            uptime,
            avgDaysPerSecond: Math.round(avgDaysPerSecond * 100) / 100,
            expectedTicks,
            tickAccuracy: Math.round((this.state.totalTicks / Math.max(1, expectedTicks)) * 100) / 100,
            currentGameTime: this.getFormattedDate().short,
            realTimePerGameDay: Math.round(1000 / this.speedModes[this.currentSpeed].daysPerTick)
        };
    }

    /**
     * Get formatted date string
     */
    getFormattedDate() {
        const currentDate = this.getCurrentDate();
        return {
            short: `${currentDate.year}-${String(currentDate.month).padStart(2, '0')}-${String(currentDate.day).padStart(2, '0')}`,
            long: `Year ${currentDate.year}, Month ${currentDate.month}, Day ${currentDate.day}`,
            dayOfYear: ((currentDate.month - 1) * this.config.daysPerMonth) + currentDate.day,
            progress: {
                dayInMonth: currentDate.day / this.config.daysPerMonth,
                monthInYear: currentDate.month / this.config.monthsPerYear,
                dayInYear: (((currentDate.month - 1) * this.config.daysPerMonth) + currentDate.day) / (this.config.monthsPerYear * this.config.daysPerMonth)
            }
        };
    }

    /**
     * Get available speed modes
     */
    getSpeedModes() {
        return Object.keys(this.speedModes).map(key => ({
            key,
            ...this.speedModes[key],
            isCurrent: key === this.currentSpeed
        }));
    }

    /**
     * Get available speeds (alias for getSpeedModes for route compatibility)
     */
    getAvailableSpeeds() {
        return this.getSpeedModes();
    }

    /**
     * Subscribe to calendar events
     */
    subscribe(callback: (event: string, data: any) => void) {
        this.subscribers.add(callback);

        // Send current state to new subscriber
        callback('state', this.getState());

        return () => {
            this.subscribers.delete(callback);
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.stop();
        this.removeAllListeners();
        this.subscribers.clear();
    }

    // Legacy methods removed - calendar state is in Rust ECS, persisted in bincode file
    async loadStateFromDB() {
        // No-op: Calendar loaded from Rust ECS via bincode file
    }

    async saveStateToDB() {
        // No-op: Calendar saved to Rust ECS via bincode file
    }
}

export default CalendarService;
