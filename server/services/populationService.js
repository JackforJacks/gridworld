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
                CREATE TABLE IF NOT EXISTS people (
                    id SERIAL PRIMARY KEY,
                    tile_id INTEGER,
                    sex BOOLEAN,
                    date_of_birth DATE,
                    residency INTEGER,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            // Ensure residency column exists (in case table was created before this column was added)
            try {
                await pool.query(`
                    ALTER TABLE people ADD COLUMN IF NOT EXISTS residency INTEGER;
                `);
            } catch (alterError) {
                // Column might already exist, ignore error
                console.log('Note: residency column handling:', alterError.message);
            }
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_people_tile_id ON people(tile_id);
            `);
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_people_residency ON people(residency);
            `);
            console.log('Table people is ready.');
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
            // Aggregate population from people table
            const result = await pool.query('SELECT tile_id, COUNT(*) as population FROM people GROUP BY tile_id');
            const populations = {};
            result.rows.forEach(row => {
                populations[row.tile_id] = parseInt(row.population, 10);
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
            // Remove tile_populations update, update people table instead
            // This will set the residency of people in the given tile to match the new population count
            // Remove or add people as needed
            // Get current count
            const result = await pool.query('SELECT COUNT(*) FROM people WHERE tile_id = $1', [tileId]);
            const currentCount = parseInt(result.rows[0].count, 10);
            if (population > currentCount) {
                // Add new people
                const toAdd = population - currentCount;
                const people = [];
                for (let i = 0; i < toAdd; i++) {
                    // Random sex, random age (1-90), residency = tileId
                    const sex = Math.random() < 0.51;
                    const age = Math.round(Math.min(90, Math.max(1, Math.exp(3 + Math.random() * 0.7))));
                    const now = new Date();
                    const birthYear = now.getFullYear() - age;
                    const birthMonth = Math.floor(Math.random() * 12) + 1;
                    const birthDay = Math.floor(Math.random() * 8) + 1;
                    const date_of_birth = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
                    people.push([tileId, sex, date_of_birth, tileId]);
                }
                const batchSize = 1000;
                for (let i = 0; i < people.length; i += batchSize) {
                    const batch = people.slice(i, i + batchSize);
                    const valuesPlaceholders = batch.map((_, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`).join(',');
                    const flatValues = batch.flat();
                    await pool.query(
                        `INSERT INTO people (tile_id, sex, date_of_birth, residency) VALUES ${valuesPlaceholders}`,
                        flatValues
                    );
                }
            } else if (population < currentCount) {
                // Remove people (delete oldest first)
                const toRemove = currentCount - population;
                await pool.query(
                    'DELETE FROM people WHERE id IN (SELECT id FROM people WHERE tile_id = $1 ORDER BY date_of_birth ASC LIMIT $2)',
                    [tileId, toRemove]
                );
            }
            await this.broadcastUpdate('populationUpdate');
        } catch (error) {
            console.error('Error updating population:', error);
        }
    } async resetPopulation() {
        try {
            // Drop the people table completely and recreate it
            await pool.query('DROP TABLE IF EXISTS people CASCADE');
            await this.ensureTableExists();
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
        // Remove all people for a fresh start
        await pool.query('DELETE FROM people');

        // Get current calendar date for age calculation
        let currentYear = 4000, currentMonth = 1, currentDay = 1;
        try {
            const calendarService = require('./calendarService');
            if (calendarService && typeof calendarService.getState === 'function') {
                const state = calendarService.getState();
                if (state && state.currentDate) {
                    currentYear = state.currentDate.year;
                    currentMonth = state.currentDate.month;
                    currentDay = state.currentDate.day;
                }
            }
        } catch (e) {
            // Fallback to default year 4000
        }

        // Insert people: 51% males, age 1-90, median 25
        // Generate random population per tile (average 100, range 80-120)
        const people = [];
        for (const tile_id of tileIds) {
            const tilePopulation = Math.floor(80 + Math.random() * 41); // 80-120 people per tile
            for (let i = 0; i < tilePopulation; i++) {
                // 51% chance male
                const sex = Math.random() < 0.51;
                // Age: skewed distribution for median ~25
                // Use log-normal distribution for realistic age
                let age = Math.round(Math.min(90, Math.max(1, Math.exp(3 + Math.random() * 0.7))));
                if (age > 90) age = 90;
                if (age < 1) age = 1;
                // Calculate date_of_birth based on current calendar date
                let birthYear = currentYear - age;
                let birthMonth = Math.floor(Math.random() * 12) + 1;
                let birthDay = Math.floor(Math.random() * 8) + 1;
                // Clamp to not exceed current date (custom calendar: 8 days/month)
                if (birthYear === currentYear) {
                    if (birthMonth > currentMonth) birthMonth = currentMonth;
                    if (birthMonth === currentMonth && birthDay > currentDay) birthDay = currentDay;
                }
                if (birthDay > 8) birthDay = 8; // Clamp to 8 days per month
                const date_of_birth = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
                people.push([tile_id, sex, date_of_birth, tile_id]); // residency = tile_id
            }
        }
        // Batch insert in chunks to avoid SQL size limits
        const batchSize = 1000; // Lowered to avoid exceeding parameter limits
        for (let i = 0; i < people.length; i += batchSize) {
            const batch = people.slice(i, i + batchSize);
            const valuesPlaceholders = batch.map((_, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`).join(',');
            const flatValues = batch.flat();
            try {
                await pool.query(
                    `INSERT INTO people (tile_id, sex, date_of_birth, residency) VALUES ${valuesPlaceholders}`,
                    flatValues
                );
            } catch (err) {
                console.error(`Error inserting people batch at index ${i} (batch size: ${batch.length}):`, err);
                console.error('Sample batch data:', batch.slice(0, 3));
                throw err;
            }
        }
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
            const data = await this.getAllPopulationData();
            this.io.emit(eventType, data);
        }
    } async updateDataAndBroadcast(eventType = 'populationUpdate') {
        await this.saveData();
        await this.broadcastUpdate(eventType);
    }

    async getAllPopulationData() {
        const populations = await this.loadData();
        const stats = await this.getPopulationStats();
        return {
            ...this.getFormattedPopulationData(populations),
            ...stats
        };
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
    } async getPopulationStats() {
        try {
            // Get current calendar date from calendarService if available
            let currentDate = new Date();
            let calendarCutoffUnder18 = null;
            let calendarCutoffOver65 = null;
            try {
                const calendarService = require('./calendarService');
                if (calendarService && typeof calendarService.getState === 'function') {
                    const state = calendarService.getState();
                    if (state && state.currentDate) {
                        // Use custom calendar system for cutoff dates
                        const { year, month, day } = state.currentDate;
                        // Under 18 cutoff
                        const under18Year = year - 18;
                        calendarCutoffUnder18 = `${under18Year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        // Over 65 cutoff
                        const over65Year = year - 65;
                        calendarCutoffOver65 = `${over65Year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        // Also set currentDate for reference
                        currentDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
                    }
                }
            } catch (e) {
                // Fallback to system date
            }
            // Fallback to JS date logic if calendarService is not available
            if (!calendarCutoffUnder18 || !calendarCutoffOver65) {
                const year = currentDate.getFullYear();
                const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                const day = String(currentDate.getDate()).padStart(2, '0');
                // Under 18
                const under18Date = new Date(currentDate);
                under18Date.setFullYear(under18Date.getFullYear() - 18);
                calendarCutoffUnder18 = `${under18Date.getFullYear()}-${String(under18Date.getMonth() + 1).padStart(2, '0')}-${String(under18Date.getDate()).padStart(2, '0')}`;
                // Over 65
                const over65Date = new Date(currentDate);
                over65Date.setFullYear(over65Date.getFullYear() - 65);
                calendarCutoffOver65 = `${over65Date.getFullYear()}-${String(over65Date.getMonth() + 1).padStart(2, '0')}-${String(over65Date.getDate()).padStart(2, '0')}`;
            }
            // Debug output
            console.log('[DEBUG] getPopulationStats custom calendar under18 cutoff:', calendarCutoffUnder18);
            console.log('[DEBUG] getPopulationStats custom calendar over65 cutoff:', calendarCutoffOver65);
            const result = await pool.query(`
                SELECT 
                    COUNT(*) FILTER (WHERE sex = true) AS male,
                    COUNT(*) FILTER (WHERE sex = false) AS female,
                    COUNT(*) FILTER (WHERE date_of_birth > $1) AS under18,
                    COUNT(*) FILTER (WHERE date_of_birth < $2) AS over65
                FROM people;`, [calendarCutoffUnder18, calendarCutoffOver65]);
            console.log('[DEBUG] getPopulationStats query result:', result.rows[0]);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting population stats:', error);
            // Return default values if query fails
            return {
                male: '0',
                female: '0',
                under18: '0',
                over65: '0'
            };
        }
    }

    // DEBUG: Print a sample of people table to diagnose demographic stats
    async printPeopleSample(limit = 10) {
        try {
            const result = await pool.query('SELECT id, sex, date_of_birth FROM people LIMIT $1', [limit]);
            console.log('Sample people table rows:');
            result.rows.forEach(row => console.log(row));
        } catch (err) {
            console.error('Error printing people sample:', err);
        }
    }
}

module.exports = new PopulationService();
