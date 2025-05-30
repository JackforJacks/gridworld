// Population Service - Handles population growth and updates
const pool = require('../config/database');
const config = require('../config/server');

class PopulationService {
    constructor(io) {
        this.io = io;
        this.growthInterval = null;
        this.autoSaveInterval = null;
        this.isGrowthEnabled = true;
        this.batchUpdateThreshold = 100;
    }

    async ensureTableExists() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS tile_populations (
                    tile_id INTEGER PRIMARY KEY,
                    population INTEGER NOT NULL DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_updated_at ON tile_populations(updated_at);
            `);
            console.log('Table tile_populations is ready.');
        } catch (error) {
            console.error('Error ensuring table exists:', error);
        }
    }

    async initialize(io) {
        this.io = io;
        await this.ensureTableExists();
        await this.initializeDatabase();
        if (this.isGrowthEnabled) {
            this.startGrowth();
        }
        this.startAutoSave();
        console.log('🌱 Population service initialized');
    }

    async initializeDatabase() {
        try {
            await pool.query('SELECT NOW()');
            console.log('Database connected successfully');
        } catch (error) {
            console.error('Database connection error:', error);
        }
    }

    async loadData() {
        try {
            const result = await pool.query('SELECT tile_id, population FROM tile_populations');
            const populations = {};
            result.rows.forEach(row => {
                populations[row.tile_id] = row.population;
            });
            return populations;
        } catch (error) {
            console.error('Error loading data from database:', error);
            return {};
        }
    }

    async saveData() {
        // Data is persisted on each update, so this can be a no-op
        return true;
    } async updatePopulation(tileId, population) {
        try {
            await pool.query(
                'INSERT INTO tile_populations (tile_id, population) VALUES ($1, $2) ON CONFLICT (tile_id) DO UPDATE SET population = $2, updated_at = CURRENT_TIMESTAMP',
                [tileId, population]
            );
            await this.broadcastUpdate('populationUpdate');
        } catch (error) {
            console.error('Error updating population:', error);
        }
    } async resetPopulation() {
        try {
            await pool.query('DELETE FROM tile_populations');
            await this.broadcastUpdate('populationReset');

            // Return the empty state after reset
            return this.getFormattedPopulationData({});
        } catch (error) {
            console.error('Error resetting population:', error);
            throw error;
        }
    } async initializeTilePopulations(tileIds) {
        this.validateTileIds(tileIds);
        if (!Array.isArray(tileIds) || tileIds.length === 0) {
            return {
                success: false,
                message: 'No tile IDs provided',
                tilePopulations: {},
                totalPopulation: 0,
                totalTiles: 0,
                lastUpdated: new Date().toISOString()
            };
        }
        // Generate random populations between 1000-10000 for each tile (like the old JSON system)
        const values = tileIds.map(id => {
            const randomPopulation = Math.floor(Math.random() * 9000) + 1000; // 1000-10000
            return `(${id}, ${randomPopulation})`;
        }).join(',');

        await pool.query(
            `INSERT INTO tile_populations (tile_id, population) VALUES ${values} 
             ON CONFLICT (tile_id) DO UPDATE SET population = EXCLUDED.population, updated_at = CURRENT_TIMESTAMP`
        );
        // Return the new state after initialization
        const populations = await this.loadData();
        return this.getFormattedPopulationData(populations);
    }

    async getPopulations() {
        return await this.loadData();
    }

    startGrowth() {
        this.stopGrowth(); // Clean stop before start

        this.growthInterval = setInterval(async () => {
            try {
                await this.updatePopulations();
            } catch (error) {
                console.error('❌ Error updating populations:', error);
            }
        }, config.populationGrowthInterval);
    } async updatePopulations() {
        const populations = await this.loadData();
        const habitableTileIds = Object.keys(populations);

        if (habitableTileIds.length === 0) return;

        const growthRate = config.defaultGrowthRate; // Use config default since we don't have global data structure anymore
        let totalGrowth = 0;
        const updates = [];

        // Prepare batch update for better performance
        habitableTileIds.forEach(tileId => {
            const growth = this.calculateGrowthForTile(tileId, growthRate);
            const newPopulation = populations[tileId] + growth;
            updates.push(`(${tileId}, ${newPopulation})`);
            totalGrowth += growth;
        });

        // Only update and broadcast if there's actual growth
        if (totalGrowth > 0 && updates.length > 0) {
            try {
                const values = updates.join(',');
                await pool.query(
                    `INSERT INTO tile_populations (tile_id, population) VALUES ${values} 
                     ON CONFLICT (tile_id) DO UPDATE SET population = EXCLUDED.population, updated_at = CURRENT_TIMESTAMP`
                );
                await this.broadcastUpdate();
            } catch (error) {
                console.error('❌ Error updating populations:', error);
            }
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
    getFormattedPopulationData(populations = null) {
        // populations: { tileId: population, ... }
        // If not provided, load from DB (sync)
        // This method is now async in most cases, but for compatibility, keep this signature
        // Use with await if you want up-to-date data
        if (!populations) {
            // This is a sync fallback, but should be avoided
            populations = {};
        }
        return {
            tilePopulations: populations,
            totalPopulation: this.getTotalPopulation(populations),
            totalTiles: Object.keys(populations).length,
            lastUpdated: new Date().toISOString()
        };
    }    // Centralized broadcasting logic
    async broadcastUpdate(eventType = 'populationUpdate') {
        if (this.io) {
            const populations = await this.loadData();
            const formattedData = this.getFormattedPopulationData(populations);
            this.io.emit(eventType, formattedData);
        }
    } async updateDataAndBroadcast(eventType = 'populationUpdate') {
        await this.saveData();
        await this.broadcastUpdate(eventType);
    }

    async getAllPopulationData() {
        const populations = await this.loadData();
        return this.getFormattedPopulationData(populations);
    }

    validateTileIds(tileIds) {
        if (!Array.isArray(tileIds) || !tileIds.every(id => typeof id === 'string' || typeof id === 'number')) {
            throw new Error('Invalid tileIds: Must be an array of strings or numbers.');
        }
        // Add any other specific validation logic for tile IDs if needed
    } async updateGrowthRate(rate) {
        if (typeof rate !== 'number' || rate < 0) {
            throw new Error('Growth rate must be a non-negative number');
        }

        // Note: With PostgreSQL, we're not storing global data anymore
        // The growth rate is managed by the config, but we can still return the formatted data
        const responseData = await this.getAllPopulationData();

        // Notify all clients
        if (this.io) {
            this.io.emit('populationUpdate', responseData);
        }

        return responseData;
    } async updateTilePopulations(tilePopulations) {
        if (!tilePopulations || typeof tilePopulations !== 'object') {
            throw new Error('tilePopulations must be an object');
        }

        const updates = [];
        let totalUpdated = 0;

        // Prepare batch update
        Object.entries(tilePopulations).forEach(([tileId, population]) => {
            if (typeof population === 'number' && population >= 0) {
                updates.push(`(${tileId}, ${population})`);
                totalUpdated++;
            }
        });

        // Only update and broadcast if there are valid updates
        if (totalUpdated > 0 && updates.length > 0) {
            try {
                const values = updates.join(',');
                await pool.query(
                    `INSERT INTO tile_populations (tile_id, population) VALUES ${values} 
                     ON CONFLICT (tile_id) DO UPDATE SET population = EXCLUDED.population, updated_at = CURRENT_TIMESTAMP`
                );
                await this.broadcastUpdate();
            } catch (error) {
                console.error('❌ Error updating tile populations:', error);
            }
        }

        // Return updated data
        const populations = await this.loadData();
        return this.getFormattedPopulationData(populations);
    }

    getTotalPopulation(populations) {
        // populations: { tileId: population, ... }
        if (!populations || typeof populations !== 'object') return 0;
        return Object.values(populations).reduce((sum, pop) => sum + (typeof pop === 'number' ? pop : 0), 0);
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
