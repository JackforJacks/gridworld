// Server Configuration
module.exports = {
    port: process.env.PORT || 8080,
    environment: process.env.NODE_ENV || 'development',
    dataFile: 'data.json',
    autoSaveInterval: 5 * 60 * 1000, // 5 minutes
    populationGrowthInterval: 1000, // 1 second
    defaultGrowthRate: 1,
};
