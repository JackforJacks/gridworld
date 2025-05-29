// Population Service - Handles population growth and updates
const dataService = require('./dataService');
const config = require('../config/server');

class PopulationService {
    constructor() {
        this.io = null;
        this.growthInterval = null;
        this.autoSaveInterval = null;
        this.isGrowthEnabled = true;
        this.batchUpdateThreshold = 100; // Batch updates for performance
    }

    async initialize(io) {
        this.io = io;
        await dataService.loadData();

        if (this.isGrowthEnabled) {
            this.startGrowth();
        }

        this.startAutoSave();
        console.log('🌱 Population service initialized');
    } startGrowth() {
        this.stopGrowth(); // Clean stop before start

        this.growthInterval = setInterval(async () => {
            try {
                await this.updatePopulations();
            } catch (error) {
                console.error('❌ Error updating populations:', error);
            }
        }, config.populationGrowthInterval);
    } async updatePopulations() {
        const data = dataService.getData();
        const habitableTileIds = Object.keys(data.tilePopulations);

        if (habitableTileIds.length === 0) return;

        const growthRate = data.globalData?.growth?.rate || config.defaultGrowthRate;
        let totalGrowth = 0;

        // Optimized: Batch update for better performance
        habitableTileIds.forEach(tileId => {
            const growth = this.calculateGrowthForTile(tileId, growthRate);
            data.tilePopulations[tileId] += growth;
            totalGrowth += growth;
        });

        data.globalData.lastUpdated = Date.now();

        // Only broadcast if there's actual growth
        if (totalGrowth > 0) {
            this.broadcastUpdate();
        }
    }

    // Calculate growth per tile (extensible for different terrain types)
    calculateGrowthForTile(tileId, baseGrowthRate) {
        // Future: Could add terrain-specific growth rates
        // const tile = dataService.getTileData(tileId);
        // return baseGrowthRate * tile.terrainMultiplier;
        return baseGrowthRate;
    }

    // Centralized data formatting
    getFormattedPopulationData() {
        const data = dataService.getData();
        return {
            globalData: data.globalData,
            tilePopulations: data.tilePopulations,
            totalPopulation: this.getTotalPopulation(),
            totalTiles: Object.keys(data.tilePopulations).length,
            lastUpdated: data.globalData.lastUpdated
        };
    }

    // Centralized broadcasting logic
    broadcastUpdate(eventType = 'populationUpdate') {
        if (this.io) {
            const formattedData = this.getFormattedPopulationData();
            this.io.emit(eventType, formattedData);
        }
    }

    async updateDataAndBroadcast(eventType = 'populationUpdate') {
        await this.saveData();
        this.broadcastUpdate(eventType);
    }

    async getAllPopulationData() {
        return this.getFormattedPopulationData();
    }

    validateTileIds(tileIds) {
        if (!Array.isArray(tileIds) || !tileIds.every(id => typeof id === 'string' || typeof id === 'number')) {
            throw new Error('Invalid tileIds: Must be an array of strings or numbers.');
        }
        // Add any other specific validation logic for tile IDs if needed
    }

    async initializeTilePopulations(habitableTileIds) {
        this.validateTileIds(habitableTileIds);

        // Batch initialization for better performance
        const batchSize = this.batchUpdateThreshold;
        for (let i = 0; i < habitableTileIds.length; i += batchSize) {
            const batch = habitableTileIds.slice(i, i + batchSize);
            batch.forEach(tileId => dataService.initializeTile(tileId));
        }

        await this.updateDataAndBroadcast('Population initialized');

        return {
            ...this.getFormattedPopulationData(),
            message: `Initialized population for ${habitableTileIds.length} habitable tiles`
        };
    }

    async updateGrowthRate(rate) {
        if (typeof rate !== 'number' || rate < 0) {
            throw new Error('Growth rate must be a non-negative number');
        }

        dataService.setGrowthRate(rate);
        await this.saveData();

        const responseData = await this.getAllPopulationData();

        // Notify all clients
        if (this.io) {
            this.io.emit('populationUpdate', responseData);
        }

        return responseData;
    }

    async updateTilePopulations(tilePopulations) {
        if (!tilePopulations || typeof tilePopulations !== 'object') {
            throw new Error('tilePopulations must be an object');
        }

        const data = dataService.getData();

        // Update tile populations
        Object.entries(tilePopulations).forEach(([tileId, population]) => {
            if (typeof population === 'number' && population >= 0) {
                data.tilePopulations[tileId] = population;
            }
        });

        data.globalData.lastUpdated = Date.now();
        await this.saveData();

        const responseData = await this.getAllPopulationData();

        // Notify all clients
        if (this.io) {
            this.io.emit('populationUpdate', responseData);
        }

        return responseData;
    }

    async resetPopulation() {
        const data = dataService.getData();
        data.tilePopulations = {};
        data.globalData.lastUpdated = Date.now();

        await this.saveData();

        const responseData = await this.getAllPopulationData();

        // Notify all clients
        if (this.io) {
            this.io.emit('populationUpdate', responseData);
        }

        return responseData;
    }

    getTotalPopulation() {
        return dataService.getTotalPopulation();
    }

    async saveData() {
        return dataService.saveData();
    }

    startAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        this.autoSaveInterval = setInterval(async () => {
            try {
                await this.saveData();
            } catch (error) {
                console.error('❌ Auto-save failed:', error);
            }
        }, config.autoSaveInterval);
    }

    stopGrowth() {
        if (this.growthInterval) {
            clearInterval(this.growthInterval);
            this.growthInterval = null;
        }
    }

    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    }

    async shutdown() {
        console.log('🛑 Shutting down population service...');
        this.stopGrowth();
        this.stopAutoSave();
        await this.saveData();
        console.log('💾 Population data saved on shutdown');
    }
}

module.exports = new PopulationService();
