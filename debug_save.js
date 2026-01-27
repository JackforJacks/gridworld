const StateManager = require('./server/services/stateManager');
const redis = require('./server/config/redis');
const { isRedisAvailable } = require('./server/config/redis');

async function waitForReady(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (isRedisAvailable()) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

(async () => {
    try {
        const ready = await waitForReady(10000);
        console.log('Redis ready:', ready, 'isRedisAvailable:', isRedisAvailable());
        if (!ready) process.exit(1);
        const res = await StateManager.saveToDatabase();
        console.log('Save result:', res);
        process.exit(0);
    } catch (err) {
        console.error('Save failed:', err);
        process.exit(1);
    }
})();