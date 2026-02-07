import EventEmitter from 'events';
import calendarConfig from '../config/calendar';
import serverConfig from '../config/server';
import { getCalendarState, setCalendarState } from '../models/calendarState';
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
    currentDate: CurrentDate;

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

        // Calendar state
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

        // Add realTimeTickMs to the internal config object if it's not coming from calendarConfig
        // This makes it explicit that CalendarService uses it.
        this.internalConfig = {
            ...this.config, // Spread the loaded config
            realTimeTickMs: parseInt(process.env.CALENDAR_TICK_INTERVAL_MS || '1000') || 1000 // Load directly or use default
        };

        // Initialize currentDate with default values (will be loaded from DB in initialize())
        this.currentDate = {
            day: this.config.startDay,
            month: this.config.startMonth,
            year: this.config.startYear
        };

        // Mark as not initialized yet - caller must await initialize()
        this._initialized = false;
    }

    /**
     * Async initialization - must be awaited before using the service
     */
    async initialize() {
        if (this._initialized) return;

        await this.loadStateFromDB();

        // Sync date from Rust ECS (source of truth)
        try {
            const rustCal = rustSimulation.getCalendar();
            if (rustCal) {
                this.currentDate = { day: rustCal.day, month: rustCal.month, year: rustCal.year };
                if (serverConfig.verboseLogs) console.log(`📅 Calendar synced from Rust: Y${rustCal.year} M${rustCal.month} D${rustCal.day}`);
            }
        } catch (e) {
            // Rust simulation may not be initialized yet; keep DB/config date
            if (serverConfig.verboseLogs) console.warn('📅 Could not sync from Rust, using DB date');
        }

        this._initialized = true;

        if (serverConfig.verboseLogs) console.log('📅 Calendar Service initialized:', {
            daysPerMonth: this.internalConfig.daysPerMonth,
            monthsPerYear: this.internalConfig.monthsPerYear,
            currentSpeed: this.speedModes[this.currentSpeed].name,
            startDate: this.getFormattedDate()
        });

        // Auto-start calendar in non-test environments only to avoid leaving timers running during tests
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
        if (serverConfig.verboseLogs) console.log(`🟢 Calendar started - ${this.speedModes[this.currentSpeed].name} (${intervalMs}ms intervals)`);

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
     */
    reset() {
        const wasRunning = this.state.isRunning;

        this.stop();

        // Reset to configured start date
        this.currentDate = {
            day: this.config.startDay,
            month: this.config.startMonth,
            year: this.config.startYear
        };

        this.state = {
            isRunning: false,
            totalDays: 0,
            totalTicks: 0,
            startTime: null,
            lastTickTime: null
        };

        this.currentSpeed = this.config.defaultSpeed;

        if (serverConfig.verboseLogs) console.log('🔄 Calendar reset to start date');
        this.emit('reset', this.getState());

        if (wasRunning && this.config.autoStart) {
            this.start();
        }

        return true;
    }

    /**
     * Advance time by exactly 1 day (called at speed-dependent intervals)
     */
    async tick(): Promise<void> {
        if (!this.state.isRunning) {
            return;
        }

        this.state.totalTicks++;
        this.state.lastTickTime = Date.now();

        const previousDate = { ...this.currentDate };
        const eventsTriggered = this.advanceOneDay();

        this.state.totalDays++;

        // Prepare event data
        const eventData = {
            previousDate,
            currentDate: { ...this.currentDate },
            daysAdvanced: 1,
            speedMode: this.speedModes[this.currentSpeed].name,
            totalTicks: this.state.totalTicks,
            totalDaysAdvanced: this.state.totalDays,
            eventsTriggered,
            populationUpdates: 1,
            state: this.getState()
        };

        // Emit tick event with comprehensive data
        this.emit('tick', eventData);

        // Broadcast to all socket clients
        if (this.io) {
            this.io.emit('calendarTick', eventData);
            this.io.emit('calendarState', this.getState());
        }
    }

    /**
     * Advance exactly one day and return any events triggered
     */
    advanceOneDay(): Array<{ type: string; date: CurrentDate; message: string }> {
        const events: Array<{ type: string; date: CurrentDate; message: string }> = [];

        // Store old values for event detection
        const oldMonth = this.currentDate.month;
        const oldYear = this.currentDate.year;

        // Advance one day
        this.currentDate.day++;

        // Check for month rollover
        if (this.currentDate.day > this.config.daysPerMonth) {
            this.currentDate.day = 1;
            this.currentDate.month++;

            events.push({
                type: 'newMonth',
                date: { ...this.currentDate },
                message: `New month started: Month ${this.currentDate.month}`
            });

            // Check for year rollover
            if (this.currentDate.month > this.config.monthsPerYear) {
                this.currentDate.month = 1;
                this.currentDate.year++;

                events.push({
                    type: 'newYear',
                    date: { ...this.currentDate },
                    message: `New year started: Year ${this.currentDate.year}`
                });

                this.emit('yearChanged', this.currentDate.year, oldYear);
            }

            this.emit('monthChanged', this.currentDate.month, oldMonth);
        }

        this.emit('dayChanged', this.currentDate.day, this.currentDate.day - 1);
        return events;
    }    /**
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
            if (serverConfig.verboseLogs) console.log(`⚡ Speed changed: ${this.speedModes[oldSpeed].name} → ${this.speedModes[speedKey].name} (${intervalMs}ms intervals)`);
        } else {
            if (serverConfig.verboseLogs) console.log(`⚡ Speed changed: ${this.speedModes[oldSpeed].name} → ${this.speedModes[speedKey].name}`);
        }

        this.emit('speedChanged', {
            oldSpeed: this.speedModes[oldSpeed],
            newSpeed: this.speedModes[speedKey],
            currentSpeed: speedKey
        });

        return true;
    }

    /**
     * Set a specific date
     */
    async setDate(day: number, month: number, year: number): Promise<boolean> {
        // Validate inputs
        if (day < 1 || day > this.config.daysPerMonth) {
            throw new Error(`Day must be between 1 and ${this.config.daysPerMonth}`);
        }
        if (month < 1 || month > this.config.monthsPerYear) {
            throw new Error(`Month must be between 1 and ${this.config.monthsPerYear}`);
        }
        if (year < 1) {
            throw new Error('Year must be positive');
        }

        const previousDate = { ...this.currentDate };
        this.currentDate = { day, month, year };

        // Recalculate total days
        this.state.totalDays = this.calculateTotalDays(year, month, day);

        if (serverConfig.verboseLogs) console.log(`📅 Date manually set: ${this.getFormattedDate().short}`);
        this.emit('dateSet', {
            previousDate,
            currentDate: { ...this.currentDate }
        });

        // Save to database with proper error handling
        try {
            await this.saveStateToDB();
        } catch (error) {
            console.error('Failed to save calendar state to database:', error);
            // Continue with in-memory state even if DB save fails
            // This prevents the application from crashing due to DB issues
        }

        return true;
    }

    /**
     * Change the tick interval (deprecated in new system)
     */
    setTickInterval(intervalMs) {
        if (serverConfig.verboseLogs) console.log('⚠️ setTickInterval is deprecated in the new calendar system. Tick interval is fixed at 1000ms.');
        return false;
    }

    /**
     * Calculate total days from start date
     */
    calculateTotalDays(year, month, day) {
        const yearsFromStart = year - this.config.startYear;
        const totalDaysInPreviousYears = yearsFromStart * this.config.monthsPerYear * this.config.daysPerMonth;
        const totalDaysInPreviousMonths = (month - 1) * this.config.daysPerMonth;
        const daysInCurrentMonth = day - 1;

        return totalDaysInPreviousYears + totalDaysInPreviousMonths + daysInCurrentMonth;
    }    /**
     * Get current calendar state
     */
    getState() {
        return {
            currentDate: this.currentDate,
            isPaused: !this.state.isRunning, // Corrected: isPaused is true if not running
            simulationTime: this.state.totalDays,
            config: this.internalConfig, // Expose internalConfig which includes realTimeTickMs
            currentSpeed: this.currentSpeed,
            speedModeDetails: this.speedModes[this.currentSpeed],
            totalTicks: this.state.totalTicks
        };
    }

    /**
     * Gets the current calendar date with fallback handling
     * This is the authoritative method for getting the current game date
     * @returns {Object} Calendar date object with year, month, day
     */
    getCurrentDate() {
        if (this.currentDate) {
            return { ...this.currentDate }; // Return a copy to prevent external modification
        }

        if (serverConfig.verboseLogs) console.warn('[CalendarService] currentDate not initialized. Using default start date.');
        return {
            year: this.config.startYear || 1,
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
        return {
            short: `${this.currentDate.year}-${String(this.currentDate.month).padStart(2, '0')}-${String(this.currentDate.day).padStart(2, '0')}`,
            long: `Year ${this.currentDate.year}, Month ${this.currentDate.month}, Day ${this.currentDate.day}`,
            dayOfYear: ((this.currentDate.month - 1) * this.config.daysPerMonth) + this.currentDate.day,
            progress: {
                dayInMonth: this.currentDate.day / this.config.daysPerMonth,
                monthInYear: this.currentDate.month / this.config.monthsPerYear,
                dayInYear: (((this.currentDate.month - 1) * this.config.daysPerMonth) + this.currentDate.day) / (this.config.monthsPerYear * this.config.daysPerMonth)
            }
        };
    }    /**
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
    subscribe(callback) {
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

    async loadStateFromDB() {
        let dbState = await getCalendarState();
        if (dbState) {
            this.currentDate = {
                year: dbState.year,
                month: dbState.month,
                day: dbState.day
            };
        } else {
            // If DB is empty, initialize with config and persist to DB
            this.currentDate = {
                year: this.config.startYear,
                month: this.config.startMonth,
                day: this.config.startDay
            };
            await setCalendarState({
                year: this.currentDate.year,
                month: this.currentDate.month,
                day: this.currentDate.day
            });
        }

        // Emit state update to clients
        this.emit('dateSet', this.getState());
        if (this.io) {
            this.io.emit('calendarDateSet', this.getState());
            this.io.emit('calendarState', this.getState());
        }
    }

    async saveStateToDB() {
        await setCalendarState({
            year: this.currentDate.year,
            month: this.currentDate.month,
            day: this.currentDate.day
        });
    }
}

export default CalendarService;
