const pool = require('./server/config/database');
const redis = require('./server/config/redis');
const { isRedisAvailable } = require('./server/config/redis');
const PopulationState = require('./server/services/populationState');
const villageSeeder = require('./server/services/villageSeeder');

async function debug() {
    // Wait for Redis to connect
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('isRedisAvailable:', isRedisAvailable());
    
    // Check current population
    const people = await redis.hgetall('person');
    console.log('People in Redis:', Object.keys(people).length);
    
    // Check tile populations
    const tilePops = await PopulationState.getAllTilePopulations();
    console.log('Tile populations:', tilePops);
    
    // Check villages before
    const villagesBefore = await redis.hgetall('village');
    console.log('Villages in Redis BEFORE:', Object.keys(villagesBefore).length);
    
    // If there's population, run seedVillagesRedisFirst
    if (Object.keys(tilePops).length > 0) {
        console.log('Running seedVillagesRedisFirst...');
        const result = await villageSeeder.seedVillagesRedisFirst();
        console.log('Result:', result);
        
        // Check villages after
        const villagesAfter = await redis.hgetall('village');
        console.log('Villages in Redis AFTER:', Object.keys(villagesAfter).length);
    } else {
        console.log('No population to seed villages for');
    }
    
    process.exit(0);
}

debug().catch(err => {
    console.error(err);
    process.exit(1);
});
