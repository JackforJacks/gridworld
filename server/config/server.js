// Server Configuration
module.exports = {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development',
    dataFile: 'data.json',
    autoSaveInterval: 60000, // 1 minute
    populationGrowthInterval: 1000, // 1 second
    defaultGrowthRate: 1,
    populationBatchSize: 100, // Added during previous refactoring, ensure it's here
    // Toggle verbose server logs with VERBOSE_LOGS=1 or VERBOSE_LOGS=true in environment
    verboseLogs: (process.env.VERBOSE_LOGS === '1' || process.env.VERBOSE_LOGS === 'true'),

    // Integrity checks during initialization: when enabled, the initializer will attempt to repair
    // duplicate Redis memberships and remove invalid entries. Use INIT_POP_REPAIR=1 to enable.
    integrityRepairOnInit: (process.env.INIT_POP_REPAIR === '1' || process.env.INIT_POP_REPAIR === 'true'),
    // If true, initialization will fail (throw) when integrity issues are detected. Use INIT_POP_FAIL=1 to enable.
    integrityFailOnInit: (process.env.INIT_POP_FAIL === '1' || process.env.INIT_POP_FAIL === 'true'),

    // Scheduled integrity audit settings
    integrityAuditEnabled: (process.env.INTEGRITY_AUDIT_ENABLED === '1' || process.env.INTEGRITY_AUDIT_ENABLED === 'true'),
    // Interval in milliseconds for scheduled audits (default 24 hours)
    integrityAuditInterval: parseInt(process.env.INTEGRITY_AUDIT_INTERVAL_MS, 10) || 24 * 60 * 60 * 1000,
    // If true, scheduled audits may perform repairs when issues are detected
    integrityRepairOnSchedule: (process.env.INTEGRITY_REPAIR_SCHEDULE === '1' || process.env.INTEGRITY_REPAIR_SCHEDULE === 'true')
};
