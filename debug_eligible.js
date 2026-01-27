const redis = require('./server/config/redis');

(async () => {
    try {
        // Wait for redis to be ready
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const tileKeys = await redis.smembers('tiles_with_eligible_males');
        console.log('Tiles with eligible males:', tileKeys);
        
        const femKeys = await redis.smembers('tiles_with_eligible_females');
        console.log('Tiles with eligible females:', femKeys);
        
        if (tileKeys.length > 0) {
            const males = await redis.scard('eligible:males:tile:' + tileKeys[0]);
            console.log('Males on tile', tileKeys[0] + ':', males);
        }
        
        if (femKeys.length > 0) {
            const females = await redis.scard('eligible:females:tile:' + femKeys[0]);
            console.log('Females on tile', femKeys[0] + ':', females);
        }
        
        const familyCount = await redis.hlen('family');
        console.log('Family count:', familyCount);
        
        const fertile = await redis.scard('eligible:pregnancy:families');
        console.log('Fertile families:', fertile);
        
        const personCount = await redis.hlen('person');
        console.log('Total people in Redis:', personCount);
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
