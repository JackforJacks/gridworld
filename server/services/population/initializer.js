// server/services/population/initializer.js
const { applySenescence } = require('./lifecycle.js');
const { startRateTracking } = require('./PopStats.js');
const config = require('../../config/server.js'); // Added for autoSaveInterval

// Function to ensure the 'people' table and its indexes exist
async function ensureTableExists(pool) {
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
        try {
            await pool.query(`
                ALTER TABLE people ADD COLUMN IF NOT EXISTS residency INTEGER;
            `);
        } catch (alterError) {
            console.warn('Note: residency column handling:', alterError.message, alterError);
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
        // It might be critical, consider re-throwing or handling more gracefully
        throw error;
    }
}

// Function to initialize the database connection (simple check)
async function initializeDatabase(pool) {
    try {
        await pool.query('SELECT NOW()');
        console.log('Database connected successfully');
    } catch (error) {
        console.error('Database connection error:', error);
        // It might be critical, consider re-throwing or handling more gracefully
        throw error;
    }
}

// Function to start the auto-save interval
function startAutoSave(serviceInstance) {
    if (serviceInstance.autoSaveInterval) {
        clearInterval(serviceInstance.autoSaveInterval);
    }
    serviceInstance.autoSaveInterval = setInterval(async () => {
        try {
            // Assuming saveData is a method on serviceInstance that needs to be called
            if (serviceInstance.saveData && typeof serviceInstance.saveData === 'function') {
                await serviceInstance.saveData();
            } else {
                console.warn('[initializer.js] serviceInstance.saveData is not a function or not available.');
            }
        } catch (error) {
            console.error('❌ Auto-save failed:', error);
        }
    }, config.autoSaveInterval); // Use config for interval
    console.log(`💾 Auto-save started (every ${config.autoSaveInterval / 1000}s)`);
}

async function initializePopulationService(serviceInstance, io, calendarService) {
    serviceInstance.io = io;
    serviceInstance.calendarService = calendarService;

    if (serviceInstance.calendarService) {
        serviceInstance.calendarService.on('monthChanged', async (newMonth, oldMonth) => {
            console.log(`📅 Month changed from ${oldMonth} to ${newMonth}, applying senescence...`);
            try {
                // Ensure serviceInstance._pool is accessible and passed correctly
                // Corrected to use serviceInstance.getPool() or direct access if #pool is made accessible
                const pool = serviceInstance.getPool ? serviceInstance.getPool() : serviceInstance._pool || serviceInstance['#pool'];
                if (!pool) {
                    console.error('Error applying monthly senescence: Database pool is not available on serviceInstance.');
                    return;
                }
                const deaths = await applySenescence(pool, serviceInstance.calendarService, serviceInstance);
                if (deaths > 0) {
                    console.log(`💀 Monthly senescence: ${deaths} people died`);
                    await serviceInstance.broadcastUpdate('monthlySenescence');
                }
            } catch (error) {
                console.error('Error applying monthly senescence:', error);
            }
        });
    }
    // Use the new helper functions, passing the pool from serviceInstance
    // Assuming serviceInstance has a way to provide its pool, e.g., a getter or direct access if not private
    const pool = serviceInstance.getPool ? serviceInstance.getPool() : serviceInstance._pool || serviceInstance['#pool'];
    if (!pool) {
        console.error('Critical error: Database pool not found on serviceInstance. Cannot initialize population service.');
        return; // Or throw an error
    }

    await ensureTableExists(pool);
    await initializeDatabase(pool);

    if (serviceInstance.isGrowthEnabled) {
        // Assuming startGrowth is a method on serviceInstance that needs to be called
        if (serviceInstance.startGrowth && typeof serviceInstance.startGrowth === 'function') {
            serviceInstance.startGrowth();
        } else {
            console.warn('[initializer.js] serviceInstance.startGrowth is not a function or not available.');
        }
    }
    // Use the new helper function
    startAutoSave(serviceInstance);
    startRateTracking(serviceInstance); // Pass serviceInstance as context
    console.log('🌱 Population service initialized (from initializer.js)');
}

module.exports = { initializePopulationService, ensureTableExists, initializeDatabase, startAutoSave };
