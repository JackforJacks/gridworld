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

        // Create family table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS family (
                id SERIAL PRIMARY KEY,
                husband_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
                wife_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
                pregnancy BOOLEAN DEFAULT FALSE,
                delivery_date DATE,
                children_ids INTEGER[] DEFAULT '{}',
                tile_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create indexes for the family table
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_family_husband_id ON family(husband_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_family_wife_id ON family(wife_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_family_tile_id ON family(tile_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_family_pregnancy ON family(pregnancy);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_family_delivery_date ON family(delivery_date);
        `);

        // Add family_id column to people if not exists (after family table exists)
        await pool.query(`
            ALTER TABLE people ADD COLUMN IF NOT EXISTS family_id INTEGER REFERENCES family(id);
        `);

        if (config.verboseLogs) console.log('✅ Tables and indexes created successfully.');
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
        if (config.verboseLogs) console.log('Database connected successfully');
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
        const startTime = Date.now();
        try {
            // Pause calendar during auto-save to prevent race conditions
            const calendarService = serviceInstance.calendarService;
            const wasRunning = calendarService?.state?.isRunning;
            if (wasRunning && calendarService) {
                calendarService.stop();
            }

            // Perform save
            let saveResult = null;
            if (serviceInstance.saveData && typeof serviceInstance.saveData === 'function') {
                saveResult = await serviceInstance.saveData();
            } else {
                console.warn('[initializer.js] serviceInstance.saveData is not a function or not available.');
            }

            // Resume calendar if it was running
            if (wasRunning && calendarService) {
                calendarService.start();
            }

            // Emit auto-save timing to clients
            const elapsed = Date.now() - startTime;
            if (serviceInstance.io) {
                serviceInstance.io.emit('autoSaveComplete', { elapsed, success: true, result: saveResult });
            }
        } catch (error) {
            console.error('❌ Auto-save failed:', error);
            // Emit failure to clients
            const elapsed = Date.now() - startTime;
            if (serviceInstance.io) {
                serviceInstance.io.emit('autoSaveComplete', { elapsed, success: false, error: error.message });
            }
            // Try to resume calendar even on error
            const calendarService = serviceInstance.calendarService;
            if (calendarService?.state?.isRunning === false && calendarService) {
                try { calendarService.start(); } catch (_) {}
            }
        }
    }, config.autoSaveInterval); // Use config for interval
    if (config.verboseLogs) console.log(`💾 Auto-save started (every ${config.autoSaveInterval / 1000}s)`);
}

async function initializePopulationService(serviceInstance, io, calendarService) {
    serviceInstance.io = io;
    serviceInstance.calendarService = calendarService;

    if (serviceInstance.calendarService) {
        // Note: Senescence now runs daily in the tick() method with daily-adjusted probability
        // for demographic realism (deaths happen gradually throughout the year)

        // Add daily family events processing
        serviceInstance.calendarService.on('dayChanged', async (newDay, oldDay) => {
            try {
                const pool = serviceInstance.getPool ? serviceInstance.getPool() : serviceInstance._pool || serviceInstance['#pool'];
                if (pool) {
                    // 1. Form new families from bachelors (call less frequently to avoid over-population)
                    if (newDay % 7 === 1) { // Only on the first day of each week
                        const { formNewFamilies } = require('./familyManager.js');
                        const newFamilies = await formNewFamilies(pool, serviceInstance.calendarService);
                        if (newFamilies > 0) {
                            // Quiet: new families formed (log suppressed)
                        }
                    }

                    // 2. Process daily family events (births and pregnancies)
                    const { processDailyFamilyEvents } = require('./lifecycle.js');
                    const familyEvents = await processDailyFamilyEvents(pool, serviceInstance.calendarService, serviceInstance);

                    if (familyEvents.deliveries > 0 || familyEvents.newPregnancies > 0) {
                        await serviceInstance.broadcastUpdate('familyEvents');
                    }
                }
            } catch (error) {
                console.error('Error processing daily family events:', error);
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
    if (config.verboseLogs) console.log('🌱 Population service initialized (from initializer.js)');
}

module.exports = { initializePopulationService, ensureTableExists, initializeDatabase, startAutoSave };
