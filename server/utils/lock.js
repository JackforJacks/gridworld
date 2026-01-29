const storage = require('../services/storage');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Acquire a lock for a key. Returns a token string if acquired, else null.
 */
const localLocks = new Map(); // Process-local fallback when storage adapter doesn't provide primitives

async function acquireLock(key, ttlMs = 5000, timeoutMs = 2000, retryDelayMs = 50) {
    try {
        const adapter = storage.getAdapter ? storage.getAdapter() : storage;
        const isRedis = adapter && adapter.client && typeof adapter.client.set === 'function' && typeof adapter.client.eval === 'function';
        const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const start = Date.now();

        // Use <= so a timeout of 0 still attempts once (immediate try, no waiting)
        while ((Date.now() - start) <= timeoutMs) {
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
                // Non-Redis adapter: use in-process local lock to avoid non-atomic get/set races in simple adapters (e.g., MemoryAdapter)
                const now = Date.now();
                const existing = localLocks.get(key);
                if (!existing || (existing && existing.expiresAt && now > existing.expiresAt)) {
                    localLocks.set(key, { token, expiresAt: Date.now() + ttlMs });
                    // Auto-expire to avoid leaks
                    setTimeout(() => {
                        const cur = localLocks.get(key);
                        if (cur && cur.token === token) localLocks.delete(key);
                    }, ttlMs + 50);
                    return token;
                }
                // else, someone holds it - will retry
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
            // Non-Redis adapter: prefer in-process localLocks to match acquireLock fallback
            const cur = localLocks.get(key);
            if (cur) {
                if (cur.token === token) {
                    localLocks.delete(key);
                    return true;
                }
                return false;
            }

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