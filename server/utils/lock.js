const storage = require('../services/storage');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Acquire a lock for a key. Returns a token string if acquired, else null.
 */
async function acquireLock(key, ttlMs = 5000, timeoutMs = 2000, retryDelayMs = 50) {
    try {
        const adapter = storage.getAdapter ? storage.getAdapter() : storage;
        const isRedis = adapter && adapter.client && typeof adapter.client.set === 'function' && typeof adapter.client.eval === 'function';
        const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const start = Date.now();

        while ((Date.now() - start) < timeoutMs) {
            if (isRedis) {
                // Use native Redis SET NX PX (ioredis supports this signature)
                try {
                    const res = await adapter.client.set(key, token, 'PX', ttlMs, 'NX');
                    if (res === 'OK' || res === 'ok' || res === 1) return token;
                } catch (e) {
                    // If client doesn't accept that signature, try alternate options
                    try {
                        const res = await adapter.client.set(key, token, { PX: ttlMs, NX: true });
                        if (res === 'OK' || res === 'ok' || res === 1) return token;
                    } catch (e2) {
                        // fallback to continue trying
                    }
                }
            } else {
                // Fallback (MemoryAdapter or other): implement a simple timed-lock using value + expiry
                const getVal = typeof adapter.get === 'function' ? adapter.get.bind(adapter) : (adapter.client && adapter.client.get ? (k) => adapter.client.get(k) : null);
                const setVal = typeof adapter.set === 'function' ? adapter.set.bind(adapter) : (adapter.client && adapter.client.set ? (k, v) => adapter.client.set(k, v) : null);
                const delVal = typeof adapter.del === 'function' ? adapter.del.bind(adapter) : (adapter.client && adapter.client.del ? (k) => adapter.client.del(k) : null);

                if (!getVal || !setVal || !delVal) return null; // cannot operate

                const raw = await getVal(key);
                if (!raw) {
                    const entry = { token, expiresAt: Date.now() + ttlMs };
                    await setVal(key, JSON.stringify(entry));
                    // verify we set it
                    const confirm = await getVal(key);
                    try {
                        const parsed = JSON.parse(confirm);
                        if (parsed && parsed.token === token) return token;
                    } catch (e) { /* ignore */ }
                } else {
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed && parsed.expiresAt && Date.now() > parsed.expiresAt) {
                            // expired - try to take over
                            const entry = { token, expiresAt: Date.now() + ttlMs };
                            await setVal(key, JSON.stringify(entry));
                            const confirm = await getVal(key);
                            const parsed2 = JSON.parse(confirm);
                            if (parsed2 && parsed2.token === token) return token;
                        }
                    } catch (e) {
                        // not a JSON entry - skip
                    }
                }
            }
            await sleep(retryDelayMs);
        }
        return null;
    } catch (err) {
        console.warn('[lock] acquireLock failed:', err && err.message ? err.message : err);
        return null;
    }
}

/**
 * Release a lock only if the token matches.
 */
async function releaseLock(key, token) {
    try {
        const adapter = storage.getAdapter ? storage.getAdapter() : storage;
        const isRedis = adapter && adapter.client && typeof adapter.client.eval === 'function';

        if (isRedis) {
            const lua = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;
            const res = await adapter.client.eval(lua, 1, key, token);
            return res === 1;
        } else {
            const getVal = typeof adapter.get === 'function' ? adapter.get.bind(adapter) : (adapter.client && adapter.client.get ? (k) => adapter.client.get(k) : null);
            const delVal = typeof adapter.del === 'function' ? adapter.del.bind(adapter) : (adapter.client && adapter.client.del ? (k) => adapter.client.del(k) : null);

            if (!getVal || !delVal) return false;
            const raw = await getVal(key);
            if (!raw) return false;
            try {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.token === token) {
                    await delVal(key);
                    return true;
                }
                return false;
            } catch (e) {
                return false;
            }
        }
    } catch (err) {
        console.warn('[lock] releaseLock failed:', err && err.message ? err.message : err);
        return false;
    }
}

module.exports = { acquireLock, releaseLock };