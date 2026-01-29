// Direct Redis check without requiring server modules
const Redis = require('ioredis');

async function check() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        db: 0
    });
    
    try {
        const inserts = await redis.smembers('pending:person:inserts');
        const deletes = await redis.smembers('pending:person:deletes');
        const personKeys = await redis.hkeys('person');
        const globalCounts = await redis.hgetall('counts:global');
        
        console.log('pending:person:inserts count:', inserts.length);
        console.log('pending:person:deletes count:', deletes.length);
        console.log('person hash count:', personKeys.length);
        console.log('counts:global:', globalCounts);
        
        if (inserts.length > 0) {
            console.log('Sample insert IDs (first 10):', inserts.slice(0, 10));
            // Check if they're negative (temp IDs)
            const negativeCount = inserts.filter(id => parseInt(id) < 0).length;
            const positiveCount = inserts.filter(id => parseInt(id) > 0).length;
            console.log('  Negative IDs:', negativeCount, '  Positive IDs:', positiveCount);
        }
        
        if (deletes.length > 0) {
            console.log('Sample delete IDs (first 10):', deletes.slice(0, 10));
            const negativeCount = deletes.filter(id => parseInt(id) < 0).length;
            const positiveCount = deletes.filter(id => parseInt(id) > 0).length;
            console.log('  Negative IDs:', negativeCount, '  Positive IDs:', positiveCount);
        }
        
        if (personKeys.length > 0) {
            console.log('Sample person IDs (first 10):', personKeys.slice(0, 10));
            const negativeCount = personKeys.filter(id => parseInt(id) < 0).length;
            const positiveCount = personKeys.filter(id => parseInt(id) > 0).length;
            console.log('  Negative IDs:', negativeCount, '  Positive IDs:', positiveCount);
        }
        
        // Check village membership sets
        const villageKeys = await redis.keys('village:*:*:people');
        console.log('Village membership sets:', villageKeys.length);
        for (const key of villageKeys.slice(0, 5)) {
            const members = await redis.scard(key);
            console.log(' ', key, ':', members, 'members');
        }
        
    } finally {
        await redis.quit();
    }
}

check().catch(console.error);
