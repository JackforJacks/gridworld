import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CalendarState as RustCalendarState, SpeedMode, TickEvent } from '../../services/api/ApiClient';

/**
 * Calendar state interface (client-side, used by CalendarDisplay etc.)
 */
interface CalendarState {
    year: number;
    month: number;
    day: number;
    isRunning: boolean;
}

/** Event listener callback type */
type CalendarEventCallback = (...args: unknown[]) => void;

/**
 * CalendarManager - Client-side calendar management and real-time updates
 * Uses Tauri invoke() for commands and listen() for real-time tick events.
 */
class CalendarManager {
    private state: CalendarState;
    private listeners: Map<string, Set<CalendarEventCallback>>;
    private unlistenTick: UnlistenFn | null;

    constructor() {
        this.state = {
            year: 1,
            month: 1,
            day: 1,
            isRunning: false,
        };

        this.listeners = new Map();
        this.unlistenTick = null;

        // Setup Tauri event listener and fetch initial state
        this.setupTauriListener();
        this.initialize();
    }

    /**
     * Initialize calendar manager by fetching current state from Rust
     */
    async initialize(): Promise<void> {
        try {
            const rustState = await invoke<RustCalendarState>('get_calendar_state');
            this.applyRustState(rustState);
        } catch (error: unknown) {
            console.error('Error initializing calendar manager:', error);
        }
    }

    /**
     * Setup Tauri event listener for calendar ticks
     */
    private async setupTauriListener(): Promise<void> {
        this.unlistenTick = await listen<TickEvent>('calendar-tick', (event) => {
            const tick = event.payload;
            this.state = {
                year: tick.year,
                month: tick.month,
                day: tick.day,
                isRunning: true,
            };
            this.emit('stateChanged', this.state);
            this.emit('tick', tick);
        });
    }

    /**
     * Apply Rust CalendarState to local state
     */
    private applyRustState(rustState: RustCalendarState): void {
        this.state = {
            year: rustState.date.year,
            month: rustState.date.month,
            day: rustState.date.day,
            isRunning: !rustState.is_paused,
        };
        this.emit('stateChanged', this.state);
    }

    /**
     * Update state externally (used by UIManager after load)
     */
    updateState(newState: unknown): void {
        const s = newState as Partial<CalendarState>;
        if (s.year !== undefined) this.state.year = s.year;
        if (s.month !== undefined) this.state.month = s.month;
        if (s.day !== undefined) this.state.day = s.day;
        if (s.isRunning !== undefined) this.state.isRunning = s.isRunning;
        this.emit('stateChanged', this.state);
    }

    /**
     * Start the calendar
     */
    async start(): Promise<boolean> {
        try {
            const rustState = await invoke<RustCalendarState>('start_calendar', {});
            this.applyRustState(rustState);
            this.state.isRunning = true;
            this.emit('started', this.state);
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
            const rustState = await invoke<RustCalendarState>('stop_calendar');
            this.applyRustState(rustState);
            this.state.isRunning = false;
            this.emit('stopped', this.state);
            return true;
        } catch (error: unknown) {
            console.error('Error stopping calendar:', error);
            return false;
        }
    }

    /**
     * Get available speed modes
     */
    async getAvailableSpeeds(): Promise<SpeedMode[] | null> {
        try {
            return await invoke<SpeedMode[]>('get_calendar_speeds');
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
            const rustState = await invoke<RustCalendarState>('set_calendar_speed', { speed });
            this.applyRustState(rustState);
            this.emit('speedChanged', this.state);
            return true;
        } catch (error: unknown) {
            console.error('Error setting calendar speed:', error);
            return false;
        }
    }

    /**
     * Get current calendar state
     */
    getState(): CalendarState {
        return { ...this.state };
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
    destroy(): void {
        if (this.unlistenTick) {
            this.unlistenTick();
            this.unlistenTick = null;
        }
        this.listeners.clear();
    }
}

export default CalendarManager;
export type { CalendarState, SpeedMode };
