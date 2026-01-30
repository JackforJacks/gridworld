// Storage Module - Direct Redis client (Redis-first architecture)
// No adapter pattern, no fallback to memory - Redis is required
import redis from '../../config/redis';
import EventEmitter from 'events';

const storageEvents = new EventEmitter();

// Forward Redis events
if (redis && typeof redis.on === 'function') {
    redis.on('ready', () => storageEvents.emit('ready'));
    redis.on('close', () => storageEvents.emit('close'));
    redis.on('error', () => storageEvents.emit('error'));
}

function isAvailable() {
    return redis && typeof redis.isReady === 'function' && redis.isReady();
}

const storage = {
    isAvailable,
    getAdapter: () => redis, // For compatibility
    client: redis,

    // Event API for lifecycle hooks
    on: (evt, cb) => storageEvents.on(evt, cb),
    emit: (evt, ...args) => storageEvents.emit(evt, ...args),

    // Wait for Redis to be ready
    waitForReady: () => redis && redis.waitForReady ? redis.waitForReady() : Promise.resolve(),

    // Direct Redis methods
    pipeline: () => redis.pipeline(),
    scanStream: (opts) => redis.scanStream(opts),

    hgetall: (k) => redis.hgetall(k),
    hget: (k, f) => redis.hget(k, f),
    hset: (k, f, v) => redis.hset(k, f, v),
    hdel: (k, f) => redis.hdel(k, f),
    hlen: (k) => redis.hlen(k),
    hincrby: (k, f, amt) => redis.hincrby(k, f, amt),

    del: (...keys) => redis.del(...keys),
    keys: (pattern) => redis.keys(pattern),
    flushdb: () => redis.flushdb(),
    incr: (k) => redis.incr(k),

    sadd: (k, ...members) => redis.sadd(k, ...members),
    srem: (k, ...members) => redis.srem(k, ...members),
    smembers: (k) => redis.smembers(k),
    sismember: (k, m) => redis.sismember(k, m),
    scard: (k) => redis.scard(k),

    zadd: (k, score, member) => redis.zadd(k, score, member),
    zrem: (k, member) => redis.zrem(k, member),
    zrangebyscore: (k, min, max, ...args) => redis.zrangebyscore(k, min, max, ...args),

    // Atomic Lua scripts for fertile family queue
    atomicEnqueueFertile: async (familyId, score) => {
        const member = String(familyId);
        const lua = `
            if redis.call('sismember', KEYS[1], ARGV[1]) == 0 then
                redis.call('sadd', KEYS[1], ARGV[1])
                redis.call('zadd', KEYS[2], ARGV[2], ARGV[1])
                return 1
            end
            return 0
        `;
        const res = await redis.eval(lua, 2, 'fertile:members', 'fertile:queue', member, String(score));
        return Number(res);
    },

    atomicPopDueFertile: async (now) => {
        const lua = `
            local items = redis.call('zrangebyscore', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 1)
            if not items or #items == 0 then return nil end
            local m = items[1]
            redis.call('zrem', KEYS[2], m)
            redis.call('srem', KEYS[1], m)
            return m
        `;
        const res = await redis.eval(lua, 2, 'fertile:members', 'fertile:queue', String(now));
        return res || null;
    }
};

export default storage;
