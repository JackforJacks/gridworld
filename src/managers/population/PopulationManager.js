// Population Manager - Handles real-time population data updates
import { io } from 'socket.io-client';

class PopulationManager {
    constructor() {
        this.socket = null;
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
        this.apiBaseUrl = '/api/population';
    }

    // Check if population data already exists
    async hasExistingPopulation() {
        try {
            const populationData = await this.makeApiRequest('');
            const hasPeople = populationData &&
                populationData.totalPopulation > 0 &&
                Object.keys(populationData.tilePopulations).length > 0;
            if (hasPeople) {
                this.updatePopulationData(populationData);
                this.notifyCallbacks('populationUpdate', populationData);
            }
            return hasPeople;
        } catch (error) {
            console.error('❌ Error checking for existing population:', error);
            return false;
        }
    }

    // OPTIMIZED: Initialize populations for habitable tiles
    async initializeTilePopulations(habitableTileIds) {
        const hasPopulation = await this.hasExistingPopulation();
        if (hasPopulation) {
            return {
                success: true,
                message: 'Using existing population data',
                isExisting: true
            };
        }
        const data = await this.makeApiRequest('/initialize', 'POST', {
            habitableTiles: habitableTileIds
        });

        // After initializing, fetch the latest population data to ensure the client is up to date
        try {
            const populationData = await this.makeApiRequest('');
            this.updatePopulationData(populationData);
            this.notifyCallbacks('populationUpdate', populationData);
        } catch (error) {
            console.error('❌ Failed to fetch population data after initialization:', error);
        }

        return data;
    }

    // Initialize connection to the server with retry logic
    async connect() {
        try {
            // Connect to the socket.io server through the webpack dev server proxy
            this.socket = io('http://localhost:8080', {
                timeout: 30000,
                transports: ['polling'], // Use only polling to bypass WebSocket proxy issues
                upgrade: false, // Disable upgrading to WebSocket
                forceNew: false,
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                maxReconnectionAttempts: 5
            });

            this.socket.on('connect', () => {
                this.isConnected = true;
                this.connectionRetries = 0; // Reset retry counter
                this.notifyCallbacks('connected', true);

                // Request initial data on connect
                this.socket.emit('getPopulation');
            });

            this.socket.on('disconnect', (reason) => {
                this.isConnected = false;
                this.notifyCallbacks('connected', false);

                // Only handle manual reconnection for certain disconnect reasons
                if (reason !== 'io client disconnect' && reason !== 'io server disconnect') {
                    this.handleReconnection();
                }
            });

            this.socket.on('populationUpdate', (data) => {
                this.updatePopulationData(data);
                this.notifyCallbacks('populationUpdate', data);
            });

            this.socket.on('connect_error', (error) => {
                console.error('🔌 Connection error:', error.message);
                this.isConnected = false;
                this.handleReconnection();
            });

            this.socket.on('error', (error) => {
                console.error('🔌 Socket error:', error.message);
            });

            // Add ping/pong for connection health
            this.socket.on('pong', () => {
                // Connection is healthy
            });

            // Periodically ping the server to keep connection alive
            this.pingInterval = setInterval(() => {
                if (this.socket && this.socket.connected) {
                    this.socket.emit('ping');
                }
            }, 30000); // Ping every 30 seconds

        } catch (error) {
            console.error('❌ Failed to connect to population server:', error);
        }
    }

    // OPTIMIZED: Handle reconnection with exponential backoff
    handleReconnection() {
        if (this.connectionRetries < this.maxRetries) {
            this.connectionRetries++;
            const delay = Math.pow(2, this.connectionRetries) * 1000; // Exponential backoff

            setTimeout(() => {
                this.connect();
            }, delay);
        }
    }

    // OPTIMIZED: Centralized data update logic
    updatePopulationData(data) {
        this.populationData = { ...this.populationData, ...data };
    }    // Disconnect from the server
    disconnect() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }

    // Get current population data
    getPopulationData() {
        return { ...this.populationData };
    }    // Get formatted total population count
    getFormattedCount() {
        return this.populationData.totalPopulation.toLocaleString();
    }

    // Get population for a specific tile
    getTilePopulation(tileId) {
        return this.populationData.tilePopulations[tileId] || 0;
    }

    // Get formatted population for a specific tile
    getFormattedTilePopulation(tileId) {
        const population = this.getTilePopulation(tileId);
        return population > 0 ? population.toLocaleString() : 'Uninhabited';
    }    // OPTIMIZED: Centralized API request method
    async makeApiRequest(endpoint = '', method = 'GET', body = null) {
        const url = `${this.apiBaseUrl}${endpoint}`;
        const options = {
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
            return data;
        } catch (error) {
            console.error(`❌ API request failed [${method} ${url}]:`, error);
            throw error;
        }
    }    // Get all tile populations
    getAllTilePopulations() {
        return { ...this.populationData.tilePopulations };
    }

    // Get total population across all tiles
    getTotalPopulation() {
        return this.populationData.totalPopulation;
    }

    // OPTIMIZED: Initialize populations for habitable tiles
    async initializeTilePopulations(habitableTileIds) {
        const data = await this.makeApiRequest('/initialize', 'POST', {
            habitableTiles: habitableTileIds
        });

        // After initializing, fetch the latest population data to ensure the client is up to date
        try {
            const populationData = await this.makeApiRequest(''); // GET request to /api/population
            this.updatePopulationData(populationData);
            this.notifyCallbacks('populationUpdate', populationData);
        } catch (error) {
            console.error('❌ Failed to fetch population data after initialization:', error);
        }

        return data;
    }

    // Subscribe to population updates
    subscribe(callback) {
        if (typeof callback === 'function') {
            this.callbacks.add(callback);
        }

        // Return unsubscribe function
        return () => {
            this.callbacks.delete(callback);
        };
    }

    // Notify all subscribers
    notifyCallbacks(eventType, data) {
        this.callbacks.forEach(callback => {
            try {
                callback(eventType, data);
            } catch (error) {
                console.error('Error in population callback:', error);
            }
        });
    }    // OPTIMIZED: Update population growth rate (admin function)
    async updateGrowthRate(rate) {
        const data = await this.makeApiRequest('', 'POST', { rate });
        console.log('✅ Growth rate updated successfully:', data);
        return data;
    }

    // OPTIMIZED: Update specific tile populations (admin function)
    async updateTilePopulations(tilePopulations) {
        const data = await this.makeApiRequest('', 'POST', { tilePopulations });
        console.log('✅ Tile populations updated successfully');
        return data;
    }

    // OPTIMIZED: Reset all tile populations to zero
    async resetPopulation() {
        const data = await this.makeApiRequest('/reset', 'POST');
        console.log('✅ All tile populations reset successfully:', data);
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
    }    // OPTIMIZED: Enhanced connection status with health check
    isConnectedToServer() {
        return this.isConnected && this.socket?.connected;
    }

    // OPTIMIZED: Get time since last update with better formatting
    getTimeSinceLastUpdate() {
        const timeDiff = Date.now() - this.populationData.globalData.lastUpdated;
        return {
            milliseconds: timeDiff,
            seconds: Math.floor(timeDiff / 1000),
            formatted: this.formatTimeDifference(timeDiff)
        };
    }

    // OPTIMIZED: Format time difference for display
    formatTimeDifference(milliseconds) {
        if (milliseconds < 1000) return 'Just now';

        const seconds = Math.floor(milliseconds / 1000);
        if (seconds < 60) return `${seconds}s ago`;

        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;

        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
    }

    // OPTIMIZED: Get growth statistics
    getGrowthStats() {
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
    async bulkUpdateTiles(updates) {
        if (!Array.isArray(updates)) {
            throw new Error('Bulk updates must be an array');
        }

        const tilePopulations = {};
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
