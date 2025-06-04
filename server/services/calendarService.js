const EventEmitter = require('events');

class CalendarService extends EventEmitter {
    constructor(io = null) {
        super();
        
        // Store socket.io instance for broadcasting
        this.io = io;
        
        // Calendar configuration from environment variables
        this.config = {
            daysPerMonth: parseInt(process.env.CALENDAR_DAYS_PER_MONTH) || 8,
            monthsPerYear: parseInt(process.env.CALENDAR_MONTHS_PER_YEAR) || 12,
            startYear: parseInt(process.env.CALENDAR_START_YEAR) || 1,
            autoStart: process.env.CALENDAR_AUTO_START !== 'false',
            defaultSpeed: process.env.CALENDAR_DEFAULT_SPEED || '1_day',
            realTimeTickMs: 1000 // Always 1 second real time
        };
        
        // Current date state
        this.currentDate = {
            day: 1,
            month: 1,
            year: this.config.startYear
        };

        // Speed modes - defines how much game time passes per real second
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
                daysPerTick: 8, // 8 days = 1 month
                description: 'Advance 1 month every second',
                populationUpdatesPerTick: 8
            },
            '4_month': {
                name: '4 Months/sec',
                daysPerTick: 32, // 8 * 4 = 32 days = 4 months
                description: 'Advance 4 months every second',
                populationUpdatesPerTick: 32
            }
        };

        // Current speed setting
        this.currentSpeed = this.config.defaultSpeed;
        
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

        console.log('📅 Calendar Service initialized:', {
            daysPerMonth: this.config.daysPerMonth,
            monthsPerYear: this.config.monthsPerYear,
            currentSpeed: this.speedModes[this.currentSpeed].name,
            realTimeInterval: `${this.config.realTimeTickMs}ms`,
            startDate: this.getFormattedDate()
        });
        
        // Auto-start if configured
        if (this.config.autoStart) {
            this.start();
        }
    }/**
     * Start the calendar ticking system (always 1 second intervals)
     */
    start() {
        if (this.state.isRunning) {
            console.log('⚠️ Calendar is already running');
            return false;
        }

        this.state.isRunning = true;
        this.state.startTime = this.state.startTime || Date.now();
        this.state.lastTickTime = Date.now();

        this.tickTimer = setInterval(() => {
            this.tick();
        }, this.config.realTimeTickMs);        console.log(`🟢 Calendar started - ${this.speedModes[this.currentSpeed].name} (${this.config.realTimeTickMs}ms intervals)`);
        
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
            console.log('⚠️ Calendar is already stopped');
            return false;
        }

        this.state.isRunning = false;
        
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }        console.log('🔴 Calendar stopped');
        
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
        
        this.currentDate = {
            day: 1,
            month: 1,
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

        console.log('🔄 Calendar reset to start date');
        this.emit('reset', this.getState());
        
        if (wasRunning && this.config.autoStart) {
            this.start();
        }
        
        return true;
    }

    /**
     * Advance time based on current speed mode
     */
    tick() {
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

        this.state.totalDays += daysToAdvance;        console.log(`📅 Advanced ${daysToAdvance} day(s): ${this.getFormattedDate().short} (Tick #${this.state.totalTicks})`);

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
        console.log(`⚡ Speed changed from ${this.speedModes[oldSpeed].name} to ${this.speedModes[speedKey].name}`);

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
        
        console.log(`📅 Date manually set: ${this.getFormattedDate().short}`);
        this.emit('dateSet', {
            previousDate,
            currentDate: { ...this.currentDate }
        });
        
        return true;
    }

    /**
     * Change the tick interval (deprecated in new system)
     */
    setTickInterval(intervalMs) {
        console.log('⚠️ setTickInterval is deprecated in the new calendar system. Tick interval is fixed at 1000ms.');
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
            currentDate: { ...this.currentDate },
            config: { ...this.config },
            currentSpeed: this.currentSpeed,
            speedMode: this.speedModes[this.currentSpeed],
            availableSpeeds: Object.keys(this.speedModes).map(key => ({
                key,
                ...this.speedModes[key]
            })),
            isRunning: this.state.isRunning,
            totalTicks: this.state.totalTicks,
            totalDaysAdvanced: this.state.totalDays,
            uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
            formattedDate: this.getFormattedDate()
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
}

module.exports = CalendarService;
