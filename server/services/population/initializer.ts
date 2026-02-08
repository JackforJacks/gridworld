// server/services/population/initializer.ts
import { startRateTracking } from './PopStats';
import config from '../../config/server'; // Added for autoSaveInterval
import * as deps from './dependencyContainer';
import { ErrorSeverity, safeExecuteSync } from '../../utils/errorHandler';
import rustSimulation from '../rustSimulation';

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

            // Save state to bincode file
            let saveResult = null;
            const StateManager = require('../stateManager').default;
            try {
                if (serviceInstance.saveData && typeof serviceInstance.saveData === 'function') {
                    saveResult = await serviceInstance.saveData();
                } else {
                    console.warn('[initializer] serviceInstance.saveData is not a function or not available.');
                }
            } catch (err: unknown) {
                console.warn('[initializer] Error during autosave:', (err as Error).message);
            }

            // Save calendar state to database during autosave
            if (calendarService && typeof calendarService.saveStateToDB === 'function') {
                try {
                    await calendarService.saveStateToDB();
                    if (config.verboseLogs) console.log('📅 Calendar state saved during autosave');
                } catch (err: unknown) {
                    console.warn('[initializer] Failed to save calendar state during autosave:', (err as Error).message);
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
        } catch (error: unknown) {
            console.error('❌ Auto-save failed:', error);
            // Emit failure to clients
            const elapsed = Date.now() - startTime;
            if (serviceInstance.io) {
                serviceInstance.io.emit('autoSaveComplete', { elapsed, success: false, error: (error as Error).message });
            }
            // Try to resume calendar even on error
            const calendarService = serviceInstance.calendarService;
            if (calendarService?.state?.isRunning === false && calendarService) {
                await safeExecuteSync(
                    () => calendarService.start(),
                    'Initializer:ResumeCalendarAfterError',
                    null,
                    ErrorSeverity.MEDIUM
                );
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
                // ─── Rust ECS tick (source of truth for population) ───
                const rustResult = rustSimulation.tick();
                if (rustResult.births > 0 || rustResult.deaths > 0 || rustResult.marriages > 0 || rustResult.pregnancies > 0) {
                    if (config.verboseLogs) {
                        console.log(`🦀 Tick: +${rustResult.births} births, -${rustResult.deaths} deaths, 💍${rustResult.marriages} marriages, 🤰${rustResult.pregnancies} pregnancies | pop: ${rustResult.population}`);
                    }
                }
                // Broadcast Rust population to all socket clients
                if (serviceInstance.io) {
                    serviceInstance.io.emit('rustPopulation', {
                        births: rustResult.births,
                        deaths: rustResult.deaths,
                        marriages: rustResult.marriages,
                        pregnancies: rustResult.pregnancies,
                        dissolutions: rustResult.dissolutions,
                        population: rustResult.population,
                    });
                }

                // ─── TS family events DISABLED (Phase 3: Rust now handles families) ───
                // The following code is kept for reference but no longer runs.
                // Rust family_system handles: pregnancies, deliveries, dissolutions.
                /*
                const pool = serviceInstance.getPool ? serviceInstance.getPool() : serviceInstance._pool || serviceInstance['#pool'];
                if (pool) {
                    // 1. Form new families from bachelors (call less frequently to avoid over-population)
                    if (newDay % 7 === 1) { // Only on the first day of each week
                        const familyManager = deps.getFamilyManager() as { formNewFamilies: (pool: unknown, calendarService: unknown) => Promise<number> };
                        const newFamilies = await familyManager.formNewFamilies(pool, serviceInstance.calendarService);
                        if (newFamilies > 0) {
                            // Quiet: new families formed (log suppressed)
                        }
                    }

                    // 2. Process daily family events (births and pregnancies)
                    const lifecycle = deps.getLifecycle() as { processDailyFamilyEvents: (pool: unknown, calendarService: unknown, serviceInstance: unknown) => Promise<{ deliveries: number; newPregnancies: number }> };
                    const familyEvents = await lifecycle.processDailyFamilyEvents(pool, serviceInstance.calendarService, serviceInstance);

                    if (familyEvents.deliveries > 0 || familyEvents.newPregnancies > 0) {
                        await serviceInstance.broadcastUpdate('familyEvents');
                    }
                }
                */
            } catch (error: unknown) {
                console.error('Error processing daily events:', error);
            }
        });
    }

    if (serviceInstance.isGrowthEnabled) {
        // Assuming startGrowth is a method on serviceInstance that needs to be called
        if (serviceInstance.startGrowth && typeof serviceInstance.startGrowth === 'function') {
            serviceInstance.startGrowth();
        } else {
            console.warn('[initializer] serviceInstance.startGrowth is not a function or not available.');
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
    if (config.verboseLogs) console.log('🌱 Population service initialized');

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
            const { verifyAndRepairIntegrity } = require('./population/integrity');
            const repair = config.integrityRepairOnSchedule || false;
            if (serviceInstance.io) serviceInstance.io.emit('integrityAuditStart', { repair });
            // Instrument audit metrics
            let metrics = safeExecuteSync(
                () => require('../metrics'),
                'Initializer:LoadMetrics',
                null,
                ErrorSeverity.LOW
            );
            const start = Date.now();
            if (metrics && metrics.auditRunCounter) metrics.auditRunCounter.inc({ source: 'scheduled', repair: repair ? 'true' : 'false' });
            const res = await verifyAndRepairIntegrity(null, null, {}, { repair });
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
        } catch (err: unknown) {
            console.error('[IntegrityAudit] Scheduled audit failed:', err);
            if (serviceInstance.io) serviceInstance.io.emit('integrityAuditError', { error: (err as Error).message || err });
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

export { initializePopulationService, startAutoSave, startIntegrityAudit, stopIntegrityAudit };
