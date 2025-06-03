// Server Configuration
module.exports = {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development',
    dataFile: 'data.json',
    autoSaveInterval: 1000, // 5 minutes
    populationGrowthInterval: 1000, // 1 second
    defaultGrowthRate: 1,
};
