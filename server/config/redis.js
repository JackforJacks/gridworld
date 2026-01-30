// Redis Configuration - Direct ioredis client (Redis-first architecture)
const Redis = require('ioredis');

// In test mode, use a mock or skip connection
const isTest = process.env.NODE_ENV === 'test';

let redis;
if (isTest) {
    // Mock Redis client for tests
    class MockRedis {
        constructor() {
            this.isReadyFlag = true;
            this.data = new Map();
            this.sets = new Map();
            this.hashes = new Map();
            this.sortedSets = new Map();
        }

        // Connection events stubs
        on(event, handler) {
            // Immediately call ready handler in test mode
            if (event === 'ready' || event === 'connect') {
                setTimeout(() => handler(), 0);
            }
            return this;
        }

        // Basic methods
        async keys(pattern) {
            // Collect all keys from all data structures
            const allKeys = [];
            for (const key of this.data.keys()) allKeys.push(key);
            for (const key of this.sets.keys()) allKeys.push(key);
            for (const key of this.hashes.keys()) allKeys.push(key);
            for (const key of this.sortedSets.keys()) allKeys.push(key);
            const uniqueKeys = [...new Set(allKeys)];

            // If pattern is '*', return all keys
            if (pattern === '*') {
                return uniqueKeys;
            }

            // Simple glob matching for common patterns used in tests
            // Only handles * wildcard at specific positions
            return uniqueKeys.filter(k => {
                // Convert Redis glob pattern to regex
                // Escape regex special characters
                let regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                // Replace * with .*
                regexStr = regexStr.replace(/\*/g, '.*');
                // Replace ? with .
                regexStr = regexStr.replace(/\?/g, '.');
                const regex = new RegExp(`^${regexStr}$`);
                return regex.test(k);
            });
        }

        async del(...keys) {
            let deleted = 0;
            for (const key of keys) {
                if (this.data.delete(key) || this.sets.delete(key) || this.hashes.delete(key) || this.sortedSets.delete(key)) {
                    deleted++;
                }
            }
            return deleted;
        }

        async flushdb() {
            this.data.clear();
            this.sets.clear();
            this.hashes.clear();
            this.sortedSets.clear();
            return 'OK';
        }

        async incr(key) {
            const current = this.data.get(key) || 0;
            const newVal = Number(current) + 1;
            this.data.set(key, newVal);
            return newVal;
        }

        // Hash methods
        async hgetall(key) {
            const hash = this.hashes.get(key);
            return hash ? { ...hash } : {};
        }

        async hget(key, field) {
            const hash = this.hashes.get(key);
            return hash && hash[field] !== undefined ? hash[field] : null;
        }

        async hset(key, field, value) {
            if (!this.hashes.has(key)) {
                this.hashes.set(key, {});
            }
            const hash = this.hashes.get(key);
            hash[field] = value;
            return 1;
        }

        async hdel(key, field) {
            const hash = this.hashes.get(key);
            if (hash && hash[field] !== undefined) {
                delete hash[field];
                return 1;
            }
            return 0;
        }

        async hlen(key) {
            const hash = this.hashes.get(key);
            return hash ? Object.keys(hash).length : 0;
        }

        async hincrby(key, field, increment) {
            if (!this.hashes.has(key)) {
                this.hashes.set(key, {});
            }
            const hash = this.hashes.get(key);
            const current = Number(hash[field] || 0);
            const newVal = current + increment;
            hash[field] = newVal;
            return newVal;
        }

        // Set methods
        async sadd(key, ...members) {
            if (!this.sets.has(key)) {
                this.sets.set(key, new Set());
            }
            const set = this.sets.get(key);
            let added = 0;
            for (const member of members) {
                if (!set.has(member)) {
                    set.add(member);
                    added++;
                }
            }
            return added;
        }

        async srem(key, ...members) {
            const set = this.sets.get(key);
            if (!set) return 0;
            let removed = 0;
            for (const member of members) {
                if (set.delete(member)) removed++;
            }
            return removed;
        }

        async smembers(key) {
            const set = this.sets.get(key);
            return set ? Array.from(set) : [];
        }

        async sismember(key, member) {
            const set = this.sets.get(key);
            return set && set.has(member) ? 1 : 0;
        }

        async scard(key) {
            const set = this.sets.get(key);
            return set ? set.size : 0;
        }

        // Sorted set methods (simplified)
        async zadd(key, score, member) {
            if (!this.sortedSets.has(key)) {
                this.sortedSets.set(key, new Map());
            }
            const zset = this.sortedSets.get(key);
            zset.set(member, Number(score));
            return 1;
        }

        async zrem(key, member) {
            const zset = this.sortedSets.get(key);
            if (zset && zset.has(member)) {
                zset.delete(member);
                return 1;
            }
            return 0;
        }

        async zrangebyscore(key, min, max, ...args) {
            const zset = this.sortedSets.get(key);
            if (!zset) return [];
            const results = [];
            for (const [member, score] of zset.entries()) {
                if (score >= Number(min) && score <= Number(max)) {
                    results.push(member);
                }
            }
            // Sort by score ascending
            results.sort((a, b) => zset.get(a) - zset.get(b));
            // Handle LIMIT option (simplified)
            const limitIdx = args.indexOf('LIMIT');
            if (limitIdx !== -1 && args.length > limitIdx + 2) {
                const offset = Number(args[limitIdx + 1]);
                const count = Number(args[limitIdx + 2]);
                return results.slice(offset, offset + count);
            }
            return results;
        }

        // Pipeline
        pipeline() {
            const commands = [];
            const mockPipe = {
                hget: (key, field) => {
                    commands.push(['hget', key, field]);
                    return mockPipe;
                },
                sadd: (key, ...members) => {
                    commands.push(['sadd', key, ...members]);
                    return mockPipe;
                },
                srem: (key, ...members) => {
                    commands.push(['srem', key, ...members]);
                    return mockPipe;
                },
                scard: (key) => {
                    commands.push(['scard', key]);
                    return mockPipe;
                },
                hset: (key, field, value) => {
                    commands.push(['hset', key, field, value]);
                    return mockPipe;
                },
                hdel: (key, field) => {
                    commands.push(['hdel', key, field]);
                    return mockPipe;
                },
                hincrby: (key, field, amount) => {
                    commands.push(['hincrby', key, field, amount]);
                    return mockPipe;
                },
                del: (...keys) => {
                    commands.push(['del', ...keys]);
                    return mockPipe;
                },
                exec: async () => {
                    const results = [];
                    for (const cmd of commands) {
                        const [method, ...args] = cmd;
                        try {
                            const result = await this[method](...args);
                            results.push([null, result]);
                        } catch (err) {
                            results.push([err, null]);
                        }
                    }
                    return results;
                }
            };
            // Bind methods to this instance
            Object.setPrototypeOf(mockPipe, this);
            return mockPipe;
        }

        // Scan stream (simplified)
        scanStream(opts) {
            const keys = [];
            for (const key of this.data.keys()) keys.push(key);
            for (const key of this.sets.keys()) keys.push(key);
            for (const key of this.hashes.keys()) keys.push(key);
            for (const key of this.sortedSets.keys()) keys.push(key);

            // Simple pattern matching for * wildcard
            const filtered = opts.match ? keys.filter(k => {
                // Convert Redis pattern to regex: * -> .*, ? -> ., escape other chars
                let pattern = opts.match;
                // Escape regex special chars except * and ?
                pattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                // Replace * with .* and ? with .
                pattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
                const regex = new RegExp(`^${pattern}$`);
                return regex.test(k);
            }) : keys;

            let index = 0;
            const batchSize = opts.count || 10;
            return {
                [Symbol.asyncIterator]: async function* () {
                    while (index < filtered.length) {
                        const chunk = filtered.slice(index, index + batchSize);
                        index += batchSize;
                        yield chunk;
                    }
                }
            };
        }

        // Lua script evaluation (simplified)
        async eval(script, numKeys, ...args) {
            // Very basic mock for the two specific scripts used
            if (script.includes('fertile:members')) {
                // Mock for atomicEnqueueFertile and atomicPopDueFertile
                // For simplicity, return 1 for enqueue, null for pop
                if (script.includes('sismember')) {
                    // atomicEnqueueFertile
                    return 1;
                } else {
                    // atomicPopDueFertile
                    return null;
                }
            }
            return null;
        }

        // Redis client properties
        isReady() {
            return this.isReadyFlag;
        }

        waitForReady() {
            return Promise.resolve();
        }
    }

    redis = new MockRedis();
} else {
    redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        retryStrategy: (times) => {
            if (times > 10) {
                console.error('❌ Redis not available after 10 retries, exiting');
                process.exit(1); // Fail fast - Redis is required
            }
            const delay = Math.min(times * 200, 2000);
            console.log(`🔴 Redis reconnecting in ${delay}ms (attempt ${times})...`);
            return delay;
        },
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        lazyConnect: false, // Connect immediately
    });
}

// Track ready state for real Redis
let isReady = false;
let readyResolve = null;
const readyPromise = new Promise(resolve => { readyResolve = resolve; });

if (redis && !isTest) {
    redis.on('connect', () => {
        // Connection established
    });

    redis.on('ready', () => {
        isReady = true;
        if (readyResolve) {
            readyResolve();
            readyResolve = null;
        }
    });

    redis.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.error('❌ Redis connection refused - Redis is REQUIRED for this application');
        } else {
            console.error('❌ Redis error:', err.message);
        }
        isReady = false;
    });

    redis.on('close', () => {
        console.log('🔴 Redis connection closed');
        isReady = false;
    });
}

// Export client with helper methods
const client = redis;
client.isReady = () => isTest ? true : isReady;
client.waitForReady = () => isTest ? Promise.resolve() : readyPromise;

module.exports = client;
