import { Socket } from 'socket.io-client';

/**
 * Calendar configuration interface
 */
interface CalendarConfig {
    daysPerMonth?: number;
    monthsPerYear?: number;
    tickIntervalMs?: number;
    [key: string]: unknown;
}

/**
 * Formatted date strings interface
 */
interface FormattedDate {
    short?: string;
    long?: string;
    iso?: string;
    [key: string]: string | undefined;
}

/**
 * Calendar state interface
 */
interface CalendarState {
    year: number;
    month: number;
    day: number;
    isRunning: boolean;
    totalDays: number;
    totalTicks: number;
    startTime: string | null;
    lastTickTime: string | null;
    config: CalendarConfig;
    formatted: FormattedDate;
}

/**
 * API response interface
 */
interface CalendarApiResponse<T = CalendarState> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Speed mode interface
 */
interface SpeedMode {
    name: string;
    intervalMs: number;
}

/**
 * Calendar statistics interface
 */
interface CalendarStats {
    totalTicks: number;
    totalDays: number;
    uptime: number;
    averageTickRate: number;
    [key: string]: unknown;
}

/**
 * Year change event data
 */
interface YearChangedData {
    newYear: number;
    oldYear: number;
}

/**
 * Month change event data
 */
interface MonthChangedData {
    newMonth: number;
    oldMonth: number;
}

/**
 * Day change event data
 */
interface DayChangedData {
    newDay: number;
    oldDay: number;
}

/** Event listener callback type */
type CalendarEventCallback = (...args: unknown[]) => void;

/**
 * CalendarManager - Client-side calendar management and real-time updates
 * Handles communication with the calendar service and provides reactive state management
 */
class CalendarManager {
    private socket: Socket;
    private apiBaseUrl: string;
    private state: CalendarState;
    private listeners: Map<string, Set<CalendarEventCallback>>;

    constructor(socket: Socket, apiBaseUrl: string = '/api/calendar') {
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
    async initialize(): Promise<void> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/state`);
            const result: CalendarApiResponse = await response.json();

            if (result.success && result.data) {
                this.updateState(result.data);
            } else {
                console.error('Failed to fetch calendar state:', result.error);
            }
        } catch (error: unknown) {
            console.error('Error initializing calendar manager:', error);
        }

        // Subscribe to real-time updates
        this.socket.emit('subscribeToCalendar');
    }

    /**
     * Setup socket event handlers for real-time updates
     */
    private setupSocketHandlers(): void {
        // Calendar state updates
        this.socket.on('calendarState', (state: CalendarState) => {
            this.updateState(state);
        });

        this.socket.on('calendarTick', (state: CalendarState) => {
            this.updateState(state);
            this.emit('tick', state);
        });

        this.socket.on('calendarStarted', (state: CalendarState) => {
            this.updateState(state);
            this.emit('started', state);
        });

        this.socket.on('calendarStopped', (state: CalendarState) => {
            this.updateState(state);
            this.emit('stopped', state);
        });

        this.socket.on('calendarReset', (state: CalendarState) => {
            this.updateState(state);
            this.emit('reset', state);
        }); this.socket.on('calendarDateSet', (state: CalendarState) => {
            this.updateState(state);
            this.emit('dateSet', state);
        });

        this.socket.on('calendarSpeedChanged', (state: CalendarState) => {
            this.updateState(state);
            this.emit('speedChanged', state);
        });

        // Specific change events
        this.socket.on('calendarYearChanged', ({ newYear, oldYear }: YearChangedData) => {
            this.emit('yearChanged', newYear, oldYear);
        });

        this.socket.on('calendarMonthChanged', ({ newMonth, oldMonth }: MonthChangedData) => {
            this.emit('monthChanged', newMonth, oldMonth);
        });

        this.socket.on('calendarDayChanged', ({ newDay, oldDay }: DayChangedData) => {
            this.emit('dayChanged', newDay, oldDay);
        });
    }

    /**
     * Update internal state and notify listeners.
     * Avoids creating an oldState copy (no consumers use it).
     */
    private updateState(newState: CalendarState): void {
        this.state = { ...newState };
        this.emit('stateChanged', this.state);
    }

    /**
     * Start the calendar
     */
    async start(): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result: CalendarApiResponse = await response.json();

            if (!result.success) {
                console.error('Failed to start calendar:', result.error);
                return false;
            }

            return true;
        } catch (error: unknown) {
            console.error('Error starting calendar:', error);
            return false;
        }
    }

    /**
     * Stop the calendar
     */
    async stop(): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result: CalendarApiResponse = await response.json();

            if (!result.success) {
                console.error('Failed to stop calendar:', result.error);
                return false;
            }

            return true;
        } catch (error: unknown) {
            console.error('Error stopping calendar:', error);
            return false;
        }
    }

    /**
     * Reset the calendar
     */
    async reset(): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result: CalendarApiResponse = await response.json();

            if (!result.success) {
                console.error('Failed to reset calendar:', result.error);
                return false;
            }

            return true;
        } catch (error: unknown) {
            console.error('Error resetting calendar:', error);
            return false;
        }
    }

    /**
     * Set a specific date
     */
    async setDate(year: number, month: number, day: number): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/date`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, month, day })
            });
            const result: CalendarApiResponse = await response.json();

            if (!result.success) {
                console.error('Failed to set date:', result.error);
                return false;
            }

            return true;
        } catch (error: unknown) {
            console.error('Error setting date:', error);
            return false;
        }
    }    /**
     * Get available speed modes
     */
    async getAvailableSpeeds(): Promise<SpeedMode[] | null> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/speeds`);
            const result: CalendarApiResponse<SpeedMode[]> = await response.json();

            if (result.success) {
                return result.data ?? null;
            } else {
                console.error('Failed to get available speeds:', result.error);
                return null;
            }
        } catch (error: unknown) {
            console.error('Error getting available speeds:', error);
            return null;
        }
    }

    /**
     * Change calendar speed
     */
    async setSpeed(speed: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/speed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ speed })
            });
            const result: CalendarApiResponse = await response.json();

            if (!result.success) {
                console.error('Failed to set calendar speed:', result.error);
                return false;
            }

            return true;
        } catch (error: unknown) {
            console.error('Error setting calendar speed:', error);
            return false;
        }
    }

    /**
     * Get calendar statistics
     */
    async getStats(): Promise<CalendarStats | null> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/stats`);
            const result: CalendarApiResponse<CalendarStats> = await response.json();

            if (result.success) {
                return result.data ?? null;
            } else {
                console.error('Failed to get calendar stats:', result.error);
                return null;
            }
        } catch (error: unknown) {
            console.error('Error getting calendar stats:', error);
            return null;
        }
    }

    /**
     * Get current calendar state
     */
    getState(): CalendarState {
        return { ...this.state };
    }

    /**
     * Get formatted date strings
     */
    getFormattedDate(): FormattedDate {
        return this.state.formatted || {};
    }

    /**
     * Get calendar configuration
     */
    getConfig(): CalendarConfig {
        return this.state.config || {};
    }

    /**
     * Check if calendar is running
     */
    isCalendarRunning(): boolean {
        return this.state.isRunning;
    }

    /**
     * Add event listener
     */
    on(event: string, callback: CalendarEventCallback): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);

        return () => {
            this.off(event, callback);
        };
    }

    /**
     * Remove event listener
     */
    off(event: string, callback: CalendarEventCallback): void {
        if (this.listeners.has(event)) {
            this.listeners.get(event)!.delete(callback);
        }
    }

    /**
     * Emit event to listeners
     */
    private emit(event: string, ...args: unknown[]): void {
        if (this.listeners.has(event)) {
            this.listeners.get(event)!.forEach(callback => {
                try {
                    callback(...args);
                } catch (error: unknown) {
                    console.error(`Error in calendar event listener for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Clean up resources
     */
    destroy(): void {        // Remove socket listeners
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
export type { CalendarState, CalendarConfig, CalendarStats, SpeedMode, FormattedDate };
