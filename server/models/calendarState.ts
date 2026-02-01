// CalendarState Model - Redis-first with Postgres for persistence only
import storage from '../services/storage';

const REDIS_KEY = 'calendar:state';

interface CalendarStateData {
    year: number;
    month: number;
    day: number;
    last_updated?: string;
}

/**
 * Get calendar state from Redis
 * Returns null if not found (caller should use defaults)
 */
export async function getCalendarState(): Promise<CalendarStateData | null> {
    if (!storage.isAvailable()) {
        console.warn('[CalendarState] Redis not available, returning null');
        return null;
    }

    try {
        const data = await storage.get(REDIS_KEY);
        if (!data) return null;
        
        const parsed = JSON.parse(data);
        return {
            year: parsed.current_year ?? parsed.year,
            month: parsed.current_month ?? parsed.month,
            day: parsed.current_day ?? parsed.day,
            last_updated: parsed.last_updated
        };
    } catch (err) {
        console.error('[CalendarState] Failed to get calendar state:', err);
        return null;
    }
}

/**
 * Save calendar state to Redis
 */
export async function setCalendarState({ year, month, day }: CalendarStateData): Promise<CalendarStateData | null> {
    if (!storage.isAvailable()) {
        console.warn('[CalendarState] Redis not available, state not saved');
        return null;
    }

    try {
        const state = {
            current_year: year,
            current_month: month,
            current_day: day,
            last_updated: new Date().toISOString()
        };
        
        await storage.set(REDIS_KEY, JSON.stringify(state));
        
        return {
            year,
            month,
            day,
            last_updated: state.last_updated
        };
    } catch (err) {
        console.error('[CalendarState] Failed to save calendar state:', err);
        return null;
    }
}

