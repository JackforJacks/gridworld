// Data Service - Handles file I/O and data persistence
const fs = require('fs-extra');
const path = require('path');
const config = require('../config/server');

class DataService {
    constructor() {
        this.data = {
            globalData: {
                lastUpdated: Date.now(),
                growth: {
                    rate: config.defaultGrowthRate,
                    interval: config.populationGrowthInterval
                }
            },
            tilePopulations: {}
        };
        this.dataFile = path.join(__dirname, '../../', config.dataFile);
    }

    async loadData() {
        try {
            if (await fs.pathExists(this.dataFile)) {
                const fileData = await fs.readJson(this.dataFile);
                this.data = { ...this.data, ...fileData };
                if (config.verboseLogs) console.log('📂 Population data loaded from file');
                return this.data;
            } else {
                await this.saveData();
                if (config.verboseLogs) console.log('📂 Created new population data file');
                return this.data;
            }
        } catch (error) {
            console.error('❌ Error loading data:', error);
            throw error;
        }
    }

    async saveData(newData = null) {
        try {
            if (newData) {
                this.data = { ...this.data, ...newData };
            }
            await fs.writeJson(this.dataFile, this.data, { spaces: 2 });
            return true;
        } catch (error) {
            console.error('❌ Failed to save data:', error);
            throw error;
        }
    }

    getData() {
        return this.data;
    }

    updateTilePopulation(tileId, population) {
        if (!this.data.tilePopulations[tileId]) {
            this.data.tilePopulations[tileId] = 0;
        }
        this.data.tilePopulations[tileId] = population;
        this.data.globalData.lastUpdated = Date.now();
    }

    getTilePopulation(tileId) {
        return this.data.tilePopulations[tileId] || 0;
    }

    getAllTilePopulations() {
        return this.data.tilePopulations;
    }

    initializeTile(tileId, initialPopulation = null) {
        if (!(tileId in this.data.tilePopulations)) {
            // Initialize with random population between 1000-10000 if not specified
            this.data.tilePopulations[tileId] = initialPopulation ||
                (Math.floor(Math.random() * 9000) + 1000);
        }
    }

    getTotalPopulation() {
        return Object.values(this.data.tilePopulations).reduce((total, pop) => total + pop, 0);
    }

    getGrowthRate() {
        return this.data.globalData.growth.rate;
    }

    setGrowthRate(rate) {
        this.data.globalData.growth.rate = rate;
        this.data.globalData.lastUpdated = Date.now();
    }
}

module.exports = new DataService();
