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
    verboseLogs: (process.env.VERBOSE_LOGS === '1' || process.env.VERBOSE_LOGS === 'true')
};
