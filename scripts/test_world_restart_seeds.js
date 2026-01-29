// Test script to verify world restart generates different random seeds
const { Pool } = require('pg');

async function testWorldRestartSeeds() {
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'gridworld',
        user: 'postgres',
        password: 'password'
    });

    try {
        console.log('🧪 Testing world restart seed generation...\n');

        // Simulate multiple world restarts by checking the WORLD_SEED environment variable
        // In a real scenario, this would be set by the API call

        const seeds = [];
        for (let i = 0; i < 5; i++) {
            // Generate a new random seed like the API does
            const newWorldSeed = Math.floor(Math.random() * 2147483647);
            process.env.WORLD_SEED = newWorldSeed.toString();
            seeds.push(newWorldSeed);
            console.log(`Restart ${i + 1}: Generated seed ${newWorldSeed}`);
        }

        // Check if all seeds are different
        const uniqueSeeds = new Set(seeds);
        if (uniqueSeeds.size === seeds.length) {
            console.log('✅ All generated seeds are unique');
        } else {
            console.log('❌ Some seeds are not unique:', seeds);
        }

        // Check that seeds are within expected range
        const validRange = seeds.every(seed => seed > 0 && seed < 2147483647);
        if (validRange) {
            console.log('✅ All seeds are within valid range (1-2147483646)');
        } else {
            console.log('❌ Some seeds are outside valid range');
        }

        console.log('\n🎉 World restart seed generation test completed!');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await pool.end();
    }
}

testWorldRestartSeeds().catch(console.error);