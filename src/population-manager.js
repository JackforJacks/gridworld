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
    }

    // Initialize connection to the server
    async connect() {
        try {
            this.socket = io();

            this.socket.on('connect', () => {
                console.log('🔗 Connected to population server');
                this.isConnected = true;
                this.notifyCallbacks('connected', true);
            });

            this.socket.on('disconnect', () => {
                console.log('❌ Disconnected from population server');
                this.isConnected = false;
                this.notifyCallbacks('connected', false);
            }); this.socket.on('populationUpdate', (data) => {
                this.populationData = data;
                this.notifyCallbacks('populationUpdate', data);
                // Population updates silently - no console logging
            });

            // Request initial data
            this.socket.emit('getPopulation');

        } catch (error) {
            console.error('❌ Failed to connect to population server:', error);
        }
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
    }

    // Get all tile populations
    getAllTilePopulations() {
        return { ...this.populationData.tilePopulations };
    }

    // Get total population across all tiles
    getTotalPopulation() {
        return this.populationData.totalPopulation;
    }

    // Initialize populations for habitable tiles
    async initializeTilePopulations(habitableTileIds) {
        try {
            const response = await fetch('/api/population/initialize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ habitableTiles: habitableTileIds })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('✅ Tile populations initialized:', data.message);
                return data;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('❌ Failed to initialize tile populations:', error);
            throw error;
        }
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
    }    // Update population growth rate (admin function)
    async updateGrowthRate(rate) {
        try {
            const response = await fetch('/api/population', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ rate })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('✅ Growth rate updated successfully:', data);
                return data;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('❌ Failed to update growth rate:', error);
            throw error;
        }
    }

    // Update specific tile populations (admin function)
    async updateTilePopulations(tilePopulations) {
        try {
            const response = await fetch('/api/population', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tilePopulations })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('✅ Tile populations updated successfully');
                return data;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('❌ Failed to update tile populations:', error);
            throw error;
        }
    }    // Reset all tile populations to zero
    async resetPopulation() {
        try {
            const response = await fetch('/api/population/reset');
            if (response.ok) {
                const data = await response.json();
                console.log('✅ All tile populations reset successfully:', data);
                return data;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('❌ Failed to reset populations:', error);
            throw error;
        }
    }

    // Get connection status
    isConnectedToServer() {
        return this.isConnected;
    }    // Get time since last update
    getTimeSinceLastUpdate() {
        return Date.now() - this.populationData.globalData.lastUpdated;
    }
}

// Create and export singleton instance
const populationManager = new PopulationManager();
export default populationManager;
