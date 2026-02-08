// Server Configuration
const serverConfig = {
    port: process.env.PORT || 3000,
    environment: (process.env.NODE_ENV || 'development'),
    dataFile: 'data.json',
    autoSaveInterval: 10000, // 10 seconds    // Enable autosave by setting AUTO_SAVE_ENABLED=1 or AUTO_SAVE_ENABLED=true in env. Defaults to false to avoid excessive writes.
    autoSaveEnabled: (process.env.AUTO_SAVE_ENABLED === '1' || process.env.AUTO_SAVE_ENABLED === 'true'), populationGrowthInterval: 1000, // 1 second
    defaultGrowthRate: 1,
    populationBatchSize: 100, // Added during previous refactoring, ensure it's here
    // Toggle verbose server logs with VERBOSE_LOGS=1 or VERBOSE_LOGS=true in environment
    verboseLogs: (process.env.VERBOSE_LOGS === '1' || process.env.VERBOSE_LOGS === 'true'),

    // Integrity checks during initialization: when enabled, the initializer will attempt to repair
    // duplicate memberships and remove invalid entries. Use INIT_POP_REPAIR=1 to enable.
    integrityRepairOnInit: (process.env.INIT_POP_REPAIR === '1' || process.env.INIT_POP_REPAIR === 'true'),
    // If true, initialization will fail (throw) when integrity issues are detected. Use INIT_POP_FAIL=1 to enable.
    integrityFailOnInit: (process.env.INIT_POP_FAIL === '1' || process.env.INIT_POP_FAIL === 'true'),

    // Persist population created at initialization into bincode file (saveToDatabase).
    // Default: disabled. Set SAVE_POP_ON_INIT=1 or SAVE_POP_ON_INIT=true to enable the immediate save during restart.
    savePopulationOnInit: (process.env.SAVE_POP_ON_INIT === '1' || process.env.SAVE_POP_ON_INIT === 'true') ? true : false,

    // Scheduled integrity audit settings
    integrityAuditEnabled: (process.env.INTEGRITY_AUDIT_ENABLED === '1' || process.env.INTEGRITY_AUDIT_ENABLED === 'true'),
    // Interval in milliseconds for scheduled audits (default 24 hours)
    integrityAuditInterval: parseInt((process.env.INTEGRITY_AUDIT_INTERVAL_MS || '0'), 10) || 24 * 60 * 60 * 1000,
    // If true, scheduled audits may perform repairs when issues are detected
    integrityRepairOnSchedule: (process.env.INTEGRITY_REPAIR_SCHEDULE === '1' || process.env.INTEGRITY_REPAIR_SCHEDULE === 'true')
    ,
    // Delivery retry configuration for contested family locks
    // Base delay (ms) used for retry scheduling. Backoff multiplier applied per attempt.
    deliveryRetryDelayMs: parseInt((process.env.DELIVERY_RETRY_DELAY_MS || '5000'), 10),
    // Max retry attempts before giving up on a delivery
    deliveryRetryMaxAttempts: parseInt((process.env.DELIVERY_RETRY_MAX_ATTEMPTS || '5'), 10),
    // Backoff multiplier applied to the base delay each retry (exponential)
    deliveryRetryBackoffMultiplier: parseFloat(process.env.DELIVERY_RETRY_BACKOFF_MULTIPLIER || '2'),
    // Delivery lock configuration
    deliveryLockTtlMs: parseInt((process.env.DELIVERY_LOCK_TTL_MS || '10000'), 10),
    deliveryLockAcquireTimeoutMs: parseInt((process.env.DELIVERY_LOCK_ACQUIRE_TIMEOUT_MS || '0'), 10),
    deliveryLockRetryDelayMs: parseInt((process.env.DELIVERY_LOCK_RETRY_DELAY_MS || '0'), 10)
};

export default serverConfig;
