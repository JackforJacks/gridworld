// server/services/population/initializer.js
const { applySenescence } = require('./lifecycle.js');
const { startRateTracking } = require('./PopStats.js');
const config = require('../../config/server.js'); // Added for autoSaveInterval
const deps = require('./dependencyContainer');

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

            // Perform save only if there are pending changes in Redis
            let saveResult = null;
            const StateManager = require('../stateManager');
            try {
                const hasPending = StateManager.isRedisAvailable() && await StateManager.hasPendingChanges();
                if (!hasPending) {
                    if (config.verboseLogs) console.log('💤 Auto-save skipped (no pending changes in Redis).');
                } else if (serviceInstance.saveData && typeof serviceInstance.saveData === 'function') {
                    saveResult = await serviceInstance.saveData();
                } else {
                    console.warn('[initializer.js] serviceInstance.saveData is not a function or not available.');
                }
            } catch (err) {
                console.warn('[initializer.js] Error checking pending changes for autosave:', err.message);
            }

            // Save calendar state to database during autosave
            if (calendarService && typeof calendarService.saveStateToDB === 'function') {
                try {
                    await calendarService.saveStateToDB();
                    if (config.verboseLogs) console.log('📅 Calendar state saved during autosave');
                } catch (err) {
                    console.warn('[initializer.js] Failed to save calendar state during autosave:', err.message);
                }
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
                try { calendarService.start(); } catch (_) { }
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
                        const { formNewFamilies } = deps.getFamilyManager();
                        const newFamilies = await formNewFamilies(pool, serviceInstance.calendarService);
                        if (newFamilies > 0) {
                            // Quiet: new families formed (log suppressed)
                        }
                    }

                    // 2. Process daily family events (births and pregnancies)
                    const { processDailyFamilyEvents } = deps.getLifecycle();
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
    // Auto-save controlled by config flag
    if (config.autoSaveEnabled) {
        startAutoSave(serviceInstance);
    } else {
        // Ensure any running autosave is stopped
        if (serviceInstance.autoSaveInterval) {
            serviceInstance.stopAutoSave();
        }
        if (config.verboseLogs) console.log('💤 Auto-save is disabled by configuration (AUTO_SAVE_ENABLED=false).');
    }
    startRateTracking(serviceInstance); // Pass serviceInstance as context
    if (config.verboseLogs) console.log('🌱 Population service initialized (from initializer.js)');

    // Start scheduled integrity audit if enabled
    if (config.integrityAuditEnabled) {
        startIntegrityAudit(serviceInstance);
    }
}

// Function to start scheduled integrity audit
function startIntegrityAudit(serviceInstance) {
    if (serviceInstance._integrityAuditInterval) {
        clearInterval(serviceInstance._integrityAuditInterval);
    }
    serviceInstance._integrityAuditInterval = setInterval(async () => {
        try {
            const pool = serviceInstance.getPool ? serviceInstance.getPool() : serviceInstance._pool || serviceInstance['#pool'];
            const { verifyAndRepairIntegrity } = require('./population/integrity');
            const repair = config.integrityRepairOnSchedule || false;
            if (serviceInstance.io) serviceInstance.io.emit('integrityAuditStart', { repair });
            // Instrument audit metrics
            let metrics; try { metrics = require('../metrics'); } catch (_) { metrics = null; }
            const start = Date.now();
            if (metrics && metrics.auditRunCounter) metrics.auditRunCounter.inc({ source: 'scheduled', repair: repair ? 'true' : 'false' });
            const res = await verifyAndRepairIntegrity(pool, null, {}, { repair });
            const durationSec = (Date.now() - start) / 1000;
            if (metrics && metrics.auditDuration) metrics.auditDuration.observe(durationSec);
            if (serviceInstance.io) serviceInstance.io.emit('integrityAuditComplete', res);

            if (!res.ok) {
                if (metrics && metrics.auditFailures) metrics.auditFailures.inc();
                const issuesCount = Array.isArray(res.details) ? res.details.reduce((sum, d) => sum + (d.duplicatesCount || d.missingCount || d.mismatchedCount || 0), 0) : 0;
                if (metrics && metrics.issuesGauge) metrics.issuesGauge.set(issuesCount);
                if (metrics && metrics.lastRunGauge) metrics.lastRunGauge.set(Date.now() / 1000);
                console.warn('[IntegrityAudit] Issues detected during scheduled audit:', res.details);
            } else {
                if (metrics && metrics.issuesGauge) metrics.issuesGauge.set(0);
                if (metrics && metrics.lastRunGauge) metrics.lastRunGauge.set(Date.now() / 1000);
                if (config.verboseLogs) console.log('[IntegrityAudit] Scheduled audit completed with no issues');
            }
        } catch (err) {
            console.error('[IntegrityAudit] Scheduled audit failed:', err);
            if (serviceInstance.io) serviceInstance.io.emit('integrityAuditError', { error: err.message || err });
        }
    }, config.integrityAuditInterval);
    if (config.verboseLogs) console.log(`🔍 Integrity audit scheduled (every ${config.integrityAuditInterval / 1000}s)`);
}

function stopIntegrityAudit(serviceInstance) {
    if (serviceInstance._integrityAuditInterval) {
        clearInterval(serviceInstance._integrityAuditInterval);
        serviceInstance._integrityAuditInterval = null;
    }
}

module.exports = { initializePopulationService, ensureTableExists, initializeDatabase, startAutoSave, startIntegrityAudit, stopIntegrityAudit };
