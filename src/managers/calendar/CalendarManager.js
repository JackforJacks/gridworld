/**
 * CalendarManager - Client-side calendar management and real-time updates
 * Handles communication with the calendar service and provides reactive state management
 */
class CalendarManager {
    constructor(socket, apiBaseUrl = '/api/calendar') {
        this.socket = socket;
        this.apiBaseUrl = apiBaseUrl;

        // Calendar state
        this.state = {
            year: 1,
            month: 1,
            day: 1,
            isRunning: false,
            totalDays: 0,
            totalTicks: 0,
            startTime: null,
            lastTickTime: null,
            config: {},
            formatted: {}
        };

        // Event listeners
        this.listeners = new Map();

        // Setup socket event handlers
        this.setupSocketHandlers();

        // Initialize state
        this.initialize();
    }

    /**
     * Initialize calendar manager by fetching current state
     */
    async initialize() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/state`);
            const result = await response.json();

            if (result.success) {
                this.updateState(result.data);
            } else {
                console.error('Failed to fetch calendar state:', result.error);
            }
        } catch (error) {
            console.error('Error initializing calendar manager:', error);
        }

        // Subscribe to real-time updates
        this.socket.emit('subscribeToCalendar');
    }

    /**
     * Setup socket event handlers for real-time updates
     */
    setupSocketHandlers() {
        // Calendar state updates
        this.socket.on('calendarState', (state) => {
            this.updateState(state);
        });

        this.socket.on('calendarTick', (state) => {
            this.updateState(state);
            this.emit('tick', state);
        });

        this.socket.on('calendarStarted', (state) => {
            this.updateState(state);
            this.emit('started', state);
        });

        this.socket.on('calendarStopped', (state) => {
            this.updateState(state);
            this.emit('stopped', state);
        });

        this.socket.on('calendarReset', (state) => {
            this.updateState(state);
            this.emit('reset', state);
        }); this.socket.on('calendarDateSet', (state) => {
            this.updateState(state);
            this.emit('dateSet', state);
        });

        this.socket.on('calendarSpeedChanged', (state) => {
            this.updateState(state);
            this.emit('speedChanged', state);
        });

        // Specific change events
        this.socket.on('calendarYearChanged', ({ newYear, oldYear }) => {
            this.emit('yearChanged', newYear, oldYear);
        });

        this.socket.on('calendarMonthChanged', ({ newMonth, oldMonth }) => {
            this.emit('monthChanged', newMonth, oldMonth);
        });

        this.socket.on('calendarDayChanged', ({ newDay, oldDay }) => {
            this.emit('dayChanged', newDay, oldDay);
        });
    }

    /**
     * Update internal state and notify listeners
     */
    updateState(newState) {
        const oldState = { ...this.state };
        this.state = { ...newState };
        this.emit('stateChanged', this.state, oldState);
    }

    /**
     * Start the calendar
     */
    async start() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();

            if (!result.success) {
                console.error('Failed to start calendar:', result.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error starting calendar:', error);
            return false;
        }
    }

    /**
     * Stop the calendar
     */
    async stop() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();

            if (!result.success) {
                console.error('Failed to stop calendar:', result.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error stopping calendar:', error);
            return false;
        }
    }

    /**
     * Reset the calendar
     */
    async reset() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();

            if (!result.success) {
                console.error('Failed to reset calendar:', result.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error resetting calendar:', error);
            return false;
        }
    }

    /**
     * Set a specific date
     */
    async setDate(year, month, day) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/date`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month, day })
            });
            const result = await response.json();

            if (!result.success) {
                console.error('Failed to set date:', result.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error setting date:', error);
            return false;
        }
    }    /**
     * Change tick interval
     */
    async setTickInterval(intervalMs) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/interval`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ intervalMs })
            });
            const result = await response.json();

            if (!result.success) {
                console.error('Failed to set tick interval:', result.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error setting tick interval:', error);
            return false;
        }
    }

    /**
     * Get available speed modes
     */
    async getAvailableSpeeds() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/speeds`);
            const result = await response.json();

            if (result.success) {
                return result.data;
            } else {
                console.error('Failed to get available speeds:', result.error);
                return null;
            }
        } catch (error) {
            console.error('Error getting available speeds:', error);
            return null;
        }
    }

    /**
     * Change calendar speed
     */
    async setSpeed(speed) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/speed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ speed })
            });
            const result = await response.json();

            if (!result.success) {
                console.error('Failed to set calendar speed:', result.error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error setting calendar speed:', error);
            return false;
        }
    }

    /**
     * Get calendar statistics
     */
    async getStats() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/stats`);
            const result = await response.json();

            if (result.success) {
                return result.data;
            } else {
                console.error('Failed to get calendar stats:', result.error);
                return null;
            }
        } catch (error) {
            console.error('Error getting calendar stats:', error);
            return null;
        }
    }

    /**
     * Get current calendar state
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Get formatted date strings
     */
    getFormattedDate() {
        return this.state.formatted || {};
    }

    /**
     * Get calendar configuration
     */
    getConfig() {
        return this.state.config || {};
    }

    /**
     * Check if calendar is running
     */
    isRunning() {
        return this.state.isRunning;
    }

    /**
     * Add event listener
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        return () => {
            this.off(event, callback);
        };
    }

    /**
     * Remove event listener
     */
    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    /**
     * Emit event to listeners
     */
    emit(event, ...args) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in calendar event listener for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Clean up resources
     */
    destroy() {        // Remove socket listeners
        const socketEvents = [
            'calendarState', 'calendarTick', 'calendarStarted', 'calendarStopped',
            'calendarReset', 'calendarDateSet', 'calendarSpeedChanged', 'calendarYearChanged',
            'calendarMonthChanged', 'calendarDayChanged'
        ];

        socketEvents.forEach(event => {
            this.socket.off(event);
        });

        // Clear event listeners
        this.listeners.clear();
    }
}

export default CalendarManager;
