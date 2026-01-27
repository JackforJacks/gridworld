const redisAdapter = require('./redisAdapter');
const MemoryAdapter = require('./memoryAdapter');

let adapter = null;
const EventEmitter = require('events');
const storageEvents = new EventEmitter();

function chooseAdapter() {
    // Prefer redis adapter if available
    try {
        if (redisAdapter.isAvailable && redisAdapter.isAvailable()) {
            adapter = redisAdapter;
        } else {
            adapter = new MemoryAdapter();
        }
    } catch (e) {
        adapter = new MemoryAdapter();
    }
}

chooseAdapter();

// Attach listeners so we dynamically switch adapters when Redis becomes available/unavailable
function attachRedisListeners() {
    try {
        const client = redisAdapter && redisAdapter.client;
        if (!client || typeof client.on !== 'function') return;

        client.on('ready', () => {
            try {
                if (adapter !== redisAdapter) {
                    adapter = redisAdapter;
                    console.log('🔁 storage: switched to Redis adapter (ready)');
                    storageEvents.emit('ready');
                }
            } catch (e) {
                console.warn('⚠️ storage: failed to switch to Redis adapter on ready:', e && e.message ? e.message : e);
            }
        });

        client.on('close', () => {
            try {
                // Fallback to memory adapter on close
                if (!(adapter instanceof MemoryAdapter)) {
                    adapter = new MemoryAdapter();
                    console.warn('⚠️ storage: Redis closed - switched to MemoryAdapter fallback');
                    storageEvents.emit('close');
                }
            } catch (e) {
                console.warn('⚠️ storage: failed to switch to MemoryAdapter on close:', e && e.message ? e.message : e);
            }
        });

        client.on('error', () => {
            // on error, ensure we have a safe fallback
            try {
                if (!(adapter instanceof MemoryAdapter)) {
                    adapter = new MemoryAdapter();
                    console.warn('⚠️ storage: Redis error - switched to MemoryAdapter fallback');
                    storageEvents.emit('error');
                }
            } catch (e) {
                console.warn('⚠️ storage: failed to handle Redis error:', e && e.message ? e.message : e);
            }
        });
    } catch (e) {
        // safe to ignore
    }
}

attachRedisListeners();

function isAvailable() {
    return adapter && (typeof adapter.isAvailable === 'function' ? adapter.isAvailable() : true);
}

module.exports = {
    isAvailable,
    getAdapter: () => adapter,
    // eventing API so other modules can react to adapter lifecycle
    on: (evt, cb) => storageEvents.on(evt, cb),
    // emit helper for tests or advanced hooks
    emit: (evt, ...args) => storageEvents.emit(evt, ...args),
    // convenience shorthands
    pipeline: (...args) => adapter.pipeline(...args),
    hgetall: (k) => {
        if (adapter && adapter.client && typeof adapter.client.hgetall === 'function') return adapter.client.hgetall(k);
        if (typeof adapter.hgetall === 'function') return adapter.hgetall(k);
        return Promise.resolve({});
    },
    hget: (k, f) => {
        if (adapter && adapter.client && typeof adapter.client.hget === 'function') return adapter.client.hget(k, f);
        if (typeof adapter.hget === 'function') return adapter.hget(k, f);
        return Promise.resolve(null);
    },
    hset: (k, f, v) => {
        if (adapter && adapter.client && typeof adapter.client.hset === 'function') return adapter.client.hset(k, f, v);
        if (typeof adapter.hset === 'function') return adapter.hset(k, f, v);
        return Promise.resolve(0);
    },
    del: (...keys) => {
        if (adapter && adapter.client && typeof adapter.client.del === 'function') return adapter.client.del(...keys);
        if (typeof adapter.del === 'function') return adapter.del(...keys);
        return Promise.resolve(0);
    },
    scanStream: (opts) => adapter.scanStream(opts),
    scard: (k) => {
        if (adapter && adapter.client && typeof adapter.client.scard === 'function') return adapter.client.scard(k);
        if (typeof adapter.scard === 'function') return adapter.scard(k);
        return Promise.resolve(0);
    },
    sadd: (k, m) => {
        if (adapter && adapter.client && typeof adapter.client.sadd === 'function') return adapter.client.sadd(k, m);
        if (typeof adapter.sadd === 'function') return adapter.sadd(k, m);
        return Promise.resolve(0);
    },
    srem: (k, m) => {
        if (adapter && adapter.client && typeof adapter.client.srem === 'function') return adapter.client.srem(k, m);
        if (typeof adapter.srem === 'function') return adapter.srem(k, m);
        return Promise.resolve(0);
    },
    hdel: (k, f) => {
        if (adapter && adapter.client && typeof adapter.client.hdel === 'function') return adapter.client.hdel(k, f);
        if (typeof adapter.hdel === 'function') return adapter.hdel(k, f);
        return Promise.resolve(0);
    },
    hincrby: (k, f, amt) => {
        if (adapter && adapter.client && typeof adapter.client.hincrby === 'function') return adapter.client.hincrby(k, f, amt);
        if (typeof adapter.hincrby === 'function') return adapter.hincrby(k, f, amt);
        return Promise.resolve(0);
    },
    smembers: (k) => {
        if (adapter && adapter.client && typeof adapter.client.smembers === 'function') return adapter.client.smembers(k);
        if (typeof adapter.smembers === 'function') return adapter.smembers(k);
        return Promise.resolve([]);
    },
    keys: (pattern = '*') => {
        if (adapter && adapter.client && typeof adapter.client.keys === 'function') return adapter.client.keys(pattern);
        if (typeof adapter.keys === 'function') return adapter.keys(pattern);
        // Fallback: aggregate keys from memory adapter structures
        const all = new Set([
            ...Object.keys(adapter.keys || {}),
            ...Object.keys(adapter.hashes || {}),
            ...Object.keys(adapter.sets || {})
        ]);
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return Promise.resolve(Array.from(all).filter(k => regex.test(k)));
    },
    incr: (k) => {
        if (adapter && adapter.client && typeof adapter.client.incr === 'function') return adapter.client.incr(k);
        if (typeof adapter.incr === 'function') return adapter.incr(k);
        return Promise.resolve(0);
    }
};
