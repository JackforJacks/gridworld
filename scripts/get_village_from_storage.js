const storage = require('../server/services/storage');

async function waitForStorageReady(timeoutMs = 10000) {
    if (storage.isAvailable && storage.isAvailable()) return;
    await new Promise(resolve => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        try { storage.on && storage.on('ready', finish); } catch (_) { /* ignore */ }
        setTimeout(finish, timeoutMs);
    });
}

async function main() {
    try {
        await waitForStorageReady();
        const adapter = storage.getAdapter ? storage.getAdapter() : null;
        try {
            const redisClient = require('../server/config/redis');
            console.log('Redis client status:', redisClient && redisClient.status);
        } catch (_) { /* ignore */ }
        console.log('Adapter in script:', adapter && adapter.constructor ? adapter.constructor.name : typeof adapter);
        const villageJson = await storage.hget('village', '1001');
        const personEntries = await storage.hgetall('person');
        console.log('Village 1001 from storage:', villageJson ? JSON.parse(villageJson) : null);
        console.log('Total people in storage:', personEntries ? Object.keys(personEntries).length : 0);
    } catch (err) {
        console.error('Failed:', err.message);
        process.exitCode = 1;
    } finally {
        process.exit();
    }
}

main();
