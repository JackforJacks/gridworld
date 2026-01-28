const EventEmitter = require('events');
const calendarConfig = require('../config/calendar'); // Import the new config file
const serverConfig = require('../config/server.js');
const { getCalendarState, setCalendarState } = require('../models/calendarState');

class CalendarService extends EventEmitter {
    constructor(io = null) {
        super();

        this.io = io;
        this.config = calendarConfig;

        // Speed modes - defines how much game time passes per real second
        // This can remain defined here or be moved to config if preferred
        this.speedModes = {
            '1_day': {
                name: '1 Day/sec',
                daysPerTick: 1,
                description: 'Advance 1 day every second',
                populationUpdatesPerTick: 1
            },
            '4_day': {
                name: '4 Days/sec',
                daysPerTick: 4,
                description: 'Advance 4 days every second',
                populationUpdatesPerTick: 4
            },
            '1_month': {
                name: '1 Month/sec',
                daysPerTick: this.config.daysPerMonth, // Use configured daysPerMonth
                description: 'Advance 1 month every second',
                populationUpdatesPerTick: this.config.daysPerMonth
            },
            '4_month': {
                name: '4 Months/sec',
                daysPerTick: this.config.daysPerMonth * 4,
                description: 'Advance 4 months every second',
                populationUpdatesPerTick: this.config.daysPerMonth * 4
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
            realTimeTickMs: parseInt(process.env.CALENDAR_TICK_INTERVAL_MS) || 1000 // Load directly or use default
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
        this._initialized = true;

        if (serverConfig.verboseLogs) console.log('📅 Calendar Service initialized:', {
            daysPerMonth: this.internalConfig.daysPerMonth,
            monthsPerYear: this.internalConfig.monthsPerYear,
            currentSpeed: this.speedModes[this.currentSpeed].name,
            realTimeInterval: `${this.internalConfig.realTimeTickMs}ms`,
            startDate: this.getFormattedDate()
        });

        // Auto-start calendar in non-test environments only to avoid leaving timers running during tests
        if (this.internalConfig.autoStart && process.env.NODE_ENV !== 'test') {
            this.start();
        }
    }

    /**
     * Start the calendar ticking system (always 1 second intervals)
     */
    start() {
        if (this.state.isRunning) {
            if (serverConfig.verboseLogs) console.log('⚠️ Calendar is already running');
            return false;
        }

        this.state.isRunning = true;
        this.state.startTime = this.state.startTime || Date.now();
        this.state.lastTickTime = Date.now();

        this.tickTimer = setInterval(() => {
            this.tick();
        }, this.internalConfig.realTimeTickMs); // Use internalConfig for realTimeTickMs
        if (serverConfig.verboseLogs) console.log(`🟢 Calendar started - ${this.speedModes[this.currentSpeed].name} (${this.internalConfig.realTimeTickMs}ms intervals)`);

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
     * Advance time based on current speed mode
     */
    async tick() {
        if (!this.state.isRunning) {
            return;
        }

        this.state.totalTicks++;
        this.state.lastTickTime = Date.now();

        const speedMode = this.speedModes[this.currentSpeed];
        const daysToAdvance = speedMode.daysPerTick;

        const previousDate = { ...this.currentDate };
        const eventsTriggered = [];

        // Advance the specified number of days
        for (let i = 0; i < daysToAdvance; i++) {
            const dayEvents = this.advanceOneDay();
            eventsTriggered.push(...dayEvents);
        }

        this.state.totalDays += daysToAdvance;

        // Prepare event data
        const eventData = {
            previousDate,
            currentDate: { ...this.currentDate },
            daysAdvanced: daysToAdvance,
            speedMode: speedMode.name,
            totalTicks: this.state.totalTicks,
            totalDaysAdvanced: this.state.totalDays,
            eventsTriggered,
            populationUpdates: speedMode.populationUpdatesPerTick,
            state: this.getState()
        };

        // Emit tick event with comprehensive data
        this.emit('tick', eventData);

        // Broadcast to all socket clients
        if (this.io) {
            this.io.emit('calendarTick', eventData);
            this.io.emit('calendarState', this.getState());
        }

        await this.saveStateToDB();
    }

    /**
     * Advance exactly one day and return any events triggered
     */
    advanceOneDay() {
        const events = [];

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
    setSpeed(speedKey) {
        if (!this.speedModes[speedKey]) {
            throw new Error(`Invalid speed: ${speedKey}. Available speeds: ${Object.keys(this.speedModes).join(', ')}`);
        }

        const oldSpeed = this.currentSpeed;
        this.currentSpeed = speedKey;

        // If running, no need to restart timer since interval is always 1 second
        if (serverConfig.verboseLogs) console.log(`⚡ Speed changed from ${this.speedModes[oldSpeed].name} to ${this.speedModes[speedKey].name}`);

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
    setDate(day, month, year) {
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

        this.saveStateToDB();

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
    getStats() {
        const currentTime = Date.now();
        const uptime = this.state.startTime ? currentTime - this.state.startTime : 0;
        const avgDaysPerSecond = this.state.totalDays / Math.max(1, uptime / 1000);
        const expectedTicks = Math.floor(uptime / this.config.realTimeTickMs);

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
                year: dbState.current_year,
                month: dbState.current_month,
                day: dbState.current_day
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
    }

    async saveStateToDB() {
        await setCalendarState({
            year: this.currentDate.year,
            month: this.currentDate.month,
            day: this.currentDate.day
        });
    }
}

module.exports = CalendarService;
