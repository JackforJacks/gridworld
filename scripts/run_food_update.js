const VillageService = require('../server/services/villageService');

VillageService.updateAllVillageFoodStoresRedis()
    .then(result => {
        console.log(`updated villages: ${result.length}`);
        if (result.length > 0) {
            console.log(result.slice(0, 3));
        }
    })
    .catch(err => {
        console.error('Update failed:', err.message);
        process.exitCode = 1;
    })
    .finally(() => {
        process.exit();
    });
