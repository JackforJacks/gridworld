// Simple Redis locking utility using SET NX PX and a Lua release script
const redis = require('../config/redis');

/**
 * Acquire a lock for a key. Returns a token string if acquired, else null.
 * @param {string} key
 * @param {number} ttlMs
 * @param {number} timeoutMs
 * @param {number} retryDelayMs
 */
async function acquireLock(key, ttlMs = 5000, timeoutMs = 2000, retryDelayMs = 50) {
    try {
        if (!redis) return null;
        const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const start = Date.now();
        while ((Date.now() - start) < timeoutMs) {
            // Use Redis SET with NX and PX for atomic acquire
            const res = await redis.set(key, token, 'PX', ttlMs, 'NX');
            if (res === 'OK') {
                return token;
            }
            // Wait a small amount before retrying
            await new Promise(r => setTimeout(r, retryDelayMs));
        }
        return null;
    } catch (err) {
        console.warn('[redisLock] acquireLock failed:', err && err.message ? err.message : err);
        return null;
    }
}

/**
 * Release a lock only if the token matches (atomic via Lua script)
 * @param {string} key
 * @param {string} token
 */
async function releaseLock(key, token) {
    try {
        if (!redis) return false;
        const lua = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        const res = await redis.eval(lua, 1, key, token);
        return res === 1;
    } catch (err) {
        console.warn('[redisLock] releaseLock failed:', err && err.message ? err.message : err);
        return false;
    }
}

module.exports = {
    acquireLock,
    releaseLock
};