// Population Manager - Handles real-time population data updates
import SocketService, { getSocketService } from '../../services/socket/SocketService';

/** Growth configuration for population updates */
interface GrowthConfig {
    rate: number;
    interval: number;
}

/** Global data structure for population state */
interface GlobalData {
    lastUpdated: number;
    growth: GrowthConfig;
}

/** Tile population mapping (tileId -> population count) */
interface TilePopulations {
    [tileId: string]: number;
}

/** Complete population data structure from API */
interface PopulationData {
    globalData: GlobalData;
    tilePopulations: TilePopulations;
    totalPopulation: number;
}

/** API response for initialization */
interface InitializeResponse {
    success: boolean;
    message: string;
    isExisting?: boolean;
}

/** Time since last update information */
interface TimeSinceUpdate {
    milliseconds: number;
    seconds: number;
    formatted: string;
}

/** Growth statistics */
interface GrowthStats {
    currentRate: number;
    interval: number;
    totalTiles: number;
    averagePopulationPerTile: number;
    lastUpdated: string;
}

/** Bulk update entry */
interface BulkUpdateEntry {
    tileId: string;
    population: number;
}

/** Population update callback function type */
type PopulationCallback = (eventType: string, data: unknown) => void;

class PopulationManager {
    private socketService: SocketService | null;
    private callbacks: Set<PopulationCallback>;
    private populationData: PopulationData;
    private isConnected: boolean;
    private reconnectAttempts: number;
    private maxReconnectAttempts: number;
    private reconnectDelay: number;
    private connectionRetries: number;
    private maxRetries: number;
    private apiBaseUrl: string;
    private pingInterval: ReturnType<typeof setInterval> | null;
    private connectionUnsubscribe: (() => void) | null;

    constructor() {
        this.socketService = null;
        this.callbacks = new Set();
        this.populationData = {
            globalData: {
                lastUpdated: 0,
                growth: {
                    rate: 1,
                    interval: 1000
                }
            },
            tilePopulations: {},
            totalPopulation: 0
        };
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.connectionRetries = 0;
        this.maxRetries = 5;
        this.apiBaseUrl = '/api/population';
        this.pingInterval = null;
        this.connectionUnsubscribe = null;
    }

    // Check if population data already exists
    async hasExistingPopulation(): Promise<boolean> {
        try {
            const populationData = await this.makeApiRequest<PopulationData>('');
            const hasPeople = populationData &&
                populationData.totalPopulation > 0 &&
                Object.keys(populationData.tilePopulations).length > 0;
            if (hasPeople) {
                this.updatePopulationData(populationData);
                this.notifyCallbacks('populationUpdate', populationData);
            }
            return !!hasPeople;
        } catch (error: unknown) {
            console.error('❌ Error checking for existing population:', error);
            return false;
        }
    }

    // OPTIMIZED: Initialize populations for habitable tiles
    async initializeTilePopulations(habitableTileIds: string[]): Promise<InitializeResponse> {
        const hasPopulation = await this.hasExistingPopulation();
        if (hasPopulation) {
            return {
                success: true,
                message: 'Using existing population data',
                isExisting: true
            };
        }
        const data = await this.makeApiRequest<InitializeResponse>('/initialize', 'POST', {
            habitableTiles: habitableTileIds
        });

        // After initializing, fetch the latest population data to ensure the client is up to date
        try {
            const populationData = await this.makeApiRequest<PopulationData>('');
            this.updatePopulationData(populationData);
            this.notifyCallbacks('populationUpdate', populationData);
        } catch (error: unknown) {
            console.error('❌ Failed to fetch population data after initialization:', error);
        }

        return data;
    }

    // Initialize connection to the server using centralized SocketService
    async connect(_forceNew: boolean = false): Promise<void> {
        try {
            // Use centralized SocketService singleton
            this.socketService = getSocketService();
            await this.socketService.connect();

            // Subscribe to connection state changes
            this.connectionUnsubscribe = this.socketService.onConnectionChange((connected) => {
                this.isConnected = connected;
                this.notifyCallbacks('connected', connected);

                if (connected) {
                    this.connectionRetries = 0;
                    // Request initial data on connect
                    this.socketService?.emit('getPopulation');
                }
            });

            // Set up population event handlers
            this.setupSocketEventHandlers();

        } catch (error: unknown) {
            console.error('❌ Failed to connect to population server:', error);
        }
    }

    // Set up socket event handlers for population updates
    private setupSocketEventHandlers(): void {
        if (!this.socketService) return;

        this.socketService.on('populationUpdate', (data: unknown) => {
            this.updatePopulationData(data as PopulationData);
            this.notifyCallbacks('populationUpdate', data);
        });

        // Handle all population-related events that carry updated data
        const populationEvents = ['populationReset', 'senescenceApplied', 'familiesCreated', 'familyEvents', 'populationRegenerated'];
        for (const eventName of populationEvents) {
            this.socketService.on(eventName, (data: unknown) => {
                this.updatePopulationData(data as PopulationData);
                this.notifyCallbacks('populationUpdate', data);
            });
        }

        // Add ping/pong for connection health
        this.socketService.on('pong', () => {
            // Connection is healthy
        });

        // Periodically ping the server to keep connection alive
        this.pingInterval = setInterval(() => {
            if (this.socketService?.getIsConnected()) {
                this.socketService.emit('ping');
            }
        }, 30000); // Ping every 30 seconds
    }

    // OPTIMIZED: Handle reconnection with exponential backoff
    handleReconnection(): void {
        if (this.connectionRetries < this.maxRetries) {
            this.connectionRetries++;
            const delay = Math.pow(2, this.connectionRetries) * 1000; // Exponential backoff

            setTimeout(() => {
                this.connect();
            }, delay);
        }
    }

    // Force a clean reconnect (used after server-side reset)
    async forceReconnect(): Promise<void> {
        this.disconnect();
        this.connectionRetries = 0;
        await this.connect(true); // force a new SID after server reset
    }

    // OPTIMIZED: Centralized data update logic
    updatePopulationData(data: Partial<PopulationData>): void {
        // [log removed]
        this.populationData = { ...this.populationData, ...data };
        // [log removed]
    }

    // Disconnect from the server
    disconnect(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        // Unsubscribe from connection state changes
        if (this.connectionUnsubscribe) {
            this.connectionUnsubscribe();
            this.connectionUnsubscribe = null;
        }

        // Note: We don't disconnect SocketService here since it's shared
        // Other modules may still need it
        this.socketService = null;
        this.isConnected = false;
    }

    // Get current population data
    getPopulationData(): PopulationData {
        return { ...this.populationData };
    }

    // Get formatted total population count
    getFormattedCount(): string {
        return this.populationData.totalPopulation.toLocaleString();
    }

    // Get population for a specific tile
    getTilePopulation(tileId: string): number {
        return this.populationData.tilePopulations[tileId] || 0;
    }

    // Get formatted population for a specific tile
    getFormattedTilePopulation(tileId: string): string {
        const population = this.getTilePopulation(tileId);
        return population > 0 ? population.toLocaleString() : 'Uninhabited';
    }

    // OPTIMIZED: Centralized API request method
    async makeApiRequest<T = unknown>(endpoint: string = '', method: string = 'GET', body: Record<string, unknown> | null = null): Promise<T> {
        const url = `${this.apiBaseUrl}${endpoint}`;
        const options: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (body && method !== 'GET') {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return data as T;
        } catch (error: unknown) {
            console.error(`❌ API request failed [${method} ${url}]:`, error);
            throw error;
        }
    }

    // Get all tile populations
    getAllTilePopulations(): TilePopulations {
        return { ...this.populationData.tilePopulations };
    }

    // Get total population across all tiles
    getTotalPopulation(): number {
        return this.populationData.totalPopulation;
    }

    // Subscribe to population updates
    subscribe(callback: PopulationCallback): () => void {
        if (typeof callback === 'function') {
            this.callbacks.add(callback);
        }

        // Return unsubscribe function
        return () => {
            this.callbacks.delete(callback);
        };
    }

    // Notify all subscribers
    notifyCallbacks(eventType: string, data: unknown): void {
        this.callbacks.forEach(callback => {
            try {
                callback(eventType, data);
            } catch (error: unknown) {
                console.error('Error in population callback:', error);
            }
        });
    }

    // OPTIMIZED: Update population growth rate (admin function)
    async updateGrowthRate(rate: number): Promise<unknown> {
        const data = await this.makeApiRequest('', 'POST', { rate });
        // [log removed]
        return data;
    }

    // OPTIMIZED: Update specific tile populations (admin function)
    async updateTilePopulations(tilePopulations: TilePopulations): Promise<unknown> {
        const data = await this.makeApiRequest('', 'POST', { tilePopulations });
        // [log removed]
        return data;
    }

    // OPTIMIZED: Reset all tile populations to zero
    async resetPopulation(): Promise<unknown> {
        const data = await this.makeApiRequest('/reset', 'POST');
        // [log removed]
        // Clear local data immediately
        this.populationData = {
            globalData: {
                lastUpdated: 0,
                growth: { rate: 1, interval: 1000 }
            },
            tilePopulations: {},
            totalPopulation: 0
        };
        this.notifyCallbacks('populationUpdate', this.populationData);
        return data;
    }

    // OPTIMIZED: Enhanced connection status with health check
    isConnectedToServer(): boolean {
        return this.isConnected && !!this.socketService?.getIsConnected();
    }

    // OPTIMIZED: Get time since last update with better formatting
    getTimeSinceLastUpdate(): TimeSinceUpdate {
        const timeDiff = Date.now() - this.populationData.globalData.lastUpdated;
        return {
            milliseconds: timeDiff,
            seconds: Math.floor(timeDiff / 1000),
            formatted: this.formatTimeDifference(timeDiff)
        };
    }

    // OPTIMIZED: Format time difference for display
    formatTimeDifference(milliseconds: number): string {
        if (milliseconds < 1000) return 'Just now';

        const seconds = Math.floor(milliseconds / 1000);
        if (seconds < 60) return `${seconds}s ago`;

        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;

        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
    }

    // OPTIMIZED: Get growth statistics
    getGrowthStats(): GrowthStats {
        const data = this.populationData;
        return {
            currentRate: data.globalData.growth.rate,
            interval: data.globalData.growth.interval,
            totalTiles: Object.keys(data.tilePopulations).length,
            averagePopulationPerTile: data.totalPopulation / Object.keys(data.tilePopulations).length || 0,
            lastUpdated: new Date(data.globalData.lastUpdated).toLocaleString()
        };
    }

    // OPTIMIZED: Bulk operations support
    async bulkUpdateTiles(updates: BulkUpdateEntry[]): Promise<unknown> {
        if (!Array.isArray(updates)) {
            throw new Error('Bulk updates must be an array');
        }

        const tilePopulations: TilePopulations = {};
        updates.forEach(({ tileId, population }) => {
            if (typeof tileId !== 'undefined' && typeof population === 'number') {
                tilePopulations[tileId] = population;
            }
        });

        return this.updateTilePopulations(tilePopulations);
    }
}

// Create and export singleton instance
const populationManager = new PopulationManager();
export default populationManager;
