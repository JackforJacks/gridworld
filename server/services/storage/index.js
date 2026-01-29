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
    flushdb: () => {
        if (adapter && adapter.client && typeof adapter.client.flushdb === 'function') return adapter.client.flushdb();
        if (typeof adapter.flushdb === 'function') return adapter.flushdb();
        // For memory adapter, clear all data
        if (adapter && typeof adapter.clear === 'function') return adapter.clear();
        return Promise.resolve();
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
    },

    // Sorted-set helpers (zset) for requeueing / retry scheduling
    zadd: (k, score, member) => {
        if (adapter && adapter.client && typeof adapter.client.zadd === 'function') return adapter.client.zadd(k, score, member);
        if (typeof adapter.zadd === 'function') return adapter.zadd(k, score, member);
        return Promise.resolve(0);
    },
    zrangebyscore: (k, min, max) => {
        if (adapter && adapter.client && typeof adapter.client.zrangebyscore === 'function') return adapter.client.zrangebyscore(k, min, max);
        if (typeof adapter.zrangebyscore === 'function') return adapter.zrangebyscore(k, min, max);
        return Promise.resolve([]);
    },
    zrem: (k, member) => {
        if (adapter && adapter.client && typeof adapter.client.zrem === 'function') return adapter.client.zrem(k, member);
        if (typeof adapter.zrem === 'function') return adapter.zrem(k, member);
        return Promise.resolve(0);
    }
    ,
    // Atomic enqueue for fertile family queue: ensures membership set + queue entry added only once
    atomicEnqueueFertile: async (familyId, score) => {
        const member = String(familyId);
        const membersKey = 'fertile:members';
        const queueKey = 'fertile:queue';
        try {
            const adapterInst = adapter;
            if (adapterInst && adapterInst.client && typeof adapterInst.client.eval === 'function') {
                // Lua: if not sismember then sadd + zadd and return 1 else return 0
                const lua = `
                    if redis.call('sismember', KEYS[1], ARGV[1]) == 0 then
                        redis.call('sadd', KEYS[1], ARGV[1])
                        redis.call('zadd', KEYS[2], ARGV[2], ARGV[1])
                        return 1
                    end
                    return 0
                `;
                const res = await adapterInst.client.eval(lua, 2, membersKey, queueKey, member, String(score));
                return Number(res);
            } else {
                // Fallback for memory adapter: check membership then add
                const exists = (await (typeof adapter.smembers === 'function' ? adapter.smembers(membersKey) : [])) || [];
                if (!exists.includes(member)) {
                    if (typeof adapter.sadd === 'function') await adapter.sadd(membersKey, member);
                    if (typeof adapter.zadd === 'function') await adapter.zadd(queueKey, score, member);
                    return 1;
                }
                return 0;
            }
        } catch (e) {
            console.warn('[storage] atomicEnqueueFertile failed:', e && e.message ? e.message : e);
            return 0;
        }
    },

    // Atomic pop one due fertile family (score <= now). Returns member or null.
    atomicPopDueFertile: async (now) => {
        const membersKey = 'fertile:members';
        const queueKey = 'fertile:queue';
        try {
            const adapterInst = adapter;
            if (adapterInst && adapterInst.client && typeof adapterInst.client.eval === 'function') {
                // Lua: get one member with score <= now, remove from zset and set atomically and return it
                const lua = `
                    local items = redis.call('zrangebyscore', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 1)
                    if not items or #items == 0 then return nil end
                    local m = items[1]
                    redis.call('zrem', KEYS[2], m)
                    redis.call('srem', KEYS[1], m)
                    return m
                `;
                const res = await adapterInst.client.eval(lua, 2, membersKey, queueKey, String(now));
                return res || null;
            } else {
                // Fallback: use zrangebyscore then zrem + srem
                if (typeof adapter.zrangebyscore !== 'function') return null;
                const items = await adapter.zrangebyscore(queueKey, '-inf', String(now));
                if (!items || items.length === 0) return null;
                const member = items[0];
                try { if (typeof adapter.zrem === 'function') await adapter.zrem(queueKey, member); } catch(_){}
                try { if (typeof adapter.srem === 'function') await adapter.srem(membersKey, member); } catch(_){}
                return member;
            }
        } catch (e) {
            console.warn('[storage] atomicPopDueFertile failed:', e && e.message ? e.message : e);
            return null;
        }
    }
};
