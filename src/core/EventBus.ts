// EventBus - Simple typed event emitter for decoupling modules
// Replaces direct method calls between UIManager <-> SceneManager

type Listener<T = unknown> = (data: T) => void;

class EventBus {
    private static instance: EventBus | null = null;
    private listeners = new Map<string, Set<Listener>>();

    private constructor() {}

    static getInstance(): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }

    on<T = unknown>(event: string, listener: Listener<T>): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener as Listener);

        // Return unsubscribe function
        return () => {
            this.listeners.get(event)?.delete(listener as Listener);
        };
    }

    emit<T = unknown>(event: string, data: T): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                handler(data);
            }
        }
    }

    removeAllListeners(event?: string): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
}

export const eventBus = EventBus.getInstance();

// ============ Typed Event Names ============
// Use these constants instead of magic strings

export const AppEvents = {
    /** Request world restart/regeneration */
    RESTART_WORLD: 'app:restartWorld',
    /** Request tile search by ID, payload: { tileId: number } */
    SEARCH_TILE: 'app:searchTile',
    /** Tile search result, payload: { point: {x,y,z} | null } */
    SEARCH_TILE_RESULT: 'app:searchTileResult',
} as const;
