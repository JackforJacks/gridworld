const storage = require('../server/services/storage');

async function resetFoodStores() {
    try {
        // Get all villages from the 'village' hash
        const villages = await storage.hgetall('village') || {};
        const villageIds = Object.keys(villages);
        console.log(`Found ${villageIds.length} villages`);

        for (const id of villageIds) {
            const villageJson = villages[id];
            if (villageJson) {
                const village = JSON.parse(villageJson);
                if (village.food_stores !== undefined) {
                    village.food_stores = 100000;
                    await storage.hset('village', id, JSON.stringify(village));
                    console.log(`Updated village ${id}: food_stores to 100000`);
                }
            }
        }

        console.log('Reset complete.');
        process.exit(0);
    } catch (err) {
        console.error('Reset failed:', err);
        process.exit(1);
    }
}

resetFoodStores();