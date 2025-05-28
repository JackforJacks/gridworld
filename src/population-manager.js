// Population Manager - Handles real-time population data updates
import { io } from 'socket.io-client';

class PopulationManager {
    constructor() {
        this.socket = null;
        this.populationData = {
            globalData: {
                lastUpdated: 0,
                growth: { rate: 1, interval: 1000 }
            },
            tilePopulations: {},
            totalPopulation: 0
        };
        this.callbacks = new Set();
        this.isConnected = false;
        this.connectionRetries = 0;
        this.maxRetries = 3;
        this.apiBaseUrl = '/api/population';
    }    // Initialize connection to the server with retry logic
    async connect() {
        try {
            this.socket = io();

            this.socket.on('connect', () => {
                console.log('🔗 Connected to population server');
                this.isConnected = true;
                this.connectionRetries = 0; // Reset retry counter
                this.notifyCallbacks('connected', true);

                // Request initial data on connect
                this.socket.emit('getPopulation');
            });

            this.socket.on('disconnect', () => {
                console.log('❌ Disconnected from population server');
                this.isConnected = false;
                this.notifyCallbacks('connected', false);
                this.handleReconnection();
            });

            this.socket.on('populationUpdate', (data) => {
                this.updatePopulationData(data);
                this.notifyCallbacks('populationUpdate', data);
            });

            this.socket.on('connect_error', (error) => {
                console.error('🔌 Connection error:', error);
                this.handleReconnection();
            });

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
                console.log(`🔄 Attempting reconnection (${this.connectionRetries}/${this.maxRetries})...`);
                this.connect();
            }, delay);
        }
    }

    // OPTIMIZED: Centralized data update logic
    updatePopulationData(data) {
        this.populationData = { ...this.populationData, ...data };
    }

    // Disconnect from the server
    disconnect() {
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
        console.log('✅ Tile populations initialized:', data.message);
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
        const data = await this.makeApiRequest('/reset');
        console.log('✅ All tile populations reset successfully:', data);
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
