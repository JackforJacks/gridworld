// Population Manager - Handles real-time population data updates
import { io } from 'socket.io-client';

class PopulationManager {
    constructor() {
        this.socket = null;
        this.populationData = {
            count: 0,
            lastUpdated: 0,
            growth: { rate: 1, interval: 1000 }
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
            });

            this.socket.on('populationUpdate', (data) => {
                this.populationData = data;
                this.notifyCallbacks('populationUpdate', data);
                console.log(`🌍 Population updated: ${data.count.toLocaleString()}`);
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
    }

    // Get formatted population count
    getFormattedCount() {
        return this.populationData.count.toLocaleString();
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
    }

    // Update population on server (admin function)
    async updatePopulation(count, rate = null) {
        try {
            const payload = { count };
            if (rate !== null) {
                payload.rate = rate;
            }

            const response = await fetch('/api/population', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                console.log('✅ Population updated successfully:', data);
                return data;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('❌ Failed to update population:', error);
            throw error;
        }
    }

    // Reset population to default value
    async resetPopulation() {
        try {
            const response = await fetch('/api/population/reset');
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Population reset successfully:', data);
                return data;
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('❌ Failed to reset population:', error);
            throw error;
        }
    }

    // Get connection status
    isConnectedToServer() {
        return this.isConnected;
    }

    // Get time since last update
    getTimeSinceLastUpdate() {
        return Date.now() - this.populationData.lastUpdated;
    }
}

// Create and export singleton instance
const populationManager = new PopulationManager();
export default populationManager;
