// Redis Configuration - Direct ioredis client (Redis-first architecture)
import Redis from 'ioredis';

// In test mode, use a mock or skip connection
const isTest = process.env.NODE_ENV === 'test';

interface ScanStreamOptions {
    match?: string;
    count?: number;
}

// Mock Redis client for tests
class MockRedis {
    isReadyFlag: boolean;
    data: Map<string, any>;
    sets: Map<string, Set<string>>;
    hashes: Map<string, Record<string, string>>;
    sortedSets: Map<string, Map<string, number>>;
    
    constructor() {
        this.isReadyFlag = true;
        this.data = new Map();
        this.sets = new Map();
        this.hashes = new Map();
        this.sortedSets = new Map();
    }

    on(event: string, handler: (...args: any[]) => void): this {
        if (event === 'ready' || event === 'connect') {
            setTimeout(() => handler(), 0);
        }
        return this;
    }

    async keys(pattern: string): Promise<string[]> {
        const allKeys: string[] = [];
        for (const key of this.data.keys()) allKeys.push(key);
        for (const key of this.sets.keys()) allKeys.push(key);
        for (const key of this.hashes.keys()) allKeys.push(key);
        for (const key of this.sortedSets.keys()) allKeys.push(key);
        const uniqueKeys = [...new Set(allKeys)];
        if (pattern === '*') return uniqueKeys;
        return uniqueKeys.filter(k => {
            let regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            regexStr = regexStr.replace(/\*/g, '.*').replace(/\?/g, '.');
            return new RegExp(`^${regexStr}$`).test(k);
        });
    }

    async del(...keys: string[]): Promise<number> {
        let deleted = 0;
        for (const key of keys) {
            if (this.data.delete(key) || this.sets.delete(key) || this.hashes.delete(key) || this.sortedSets.delete(key)) {
                deleted++;
            }
        }
        return deleted;
    }

    async flushdb(): Promise<string> {
        this.data.clear();
        this.sets.clear();
        this.hashes.clear();
        this.sortedSets.clear();
        return 'OK';
    }

    async incr(key: string): Promise<number> {
        const current = this.data.get(key) || 0;
        const newVal = Number(current) + 1;
        this.data.set(key, newVal);
        return newVal;
    }

    async get(key: string): Promise<string | null> {
        return this.data.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<string> {
        this.data.set(key, value);
        return 'OK';
    }

    async hgetall(key: string): Promise<Record<string, string>> {
        const hash = this.hashes.get(key);
        return hash ? { ...hash } : {};
    }

    async hget(key: string, field: string): Promise<string | null> {
        const hash = this.hashes.get(key);
        return hash && hash[field] !== undefined ? hash[field] : null;
    }

    async hset(key: string, field: string, value: string): Promise<number> {
        if (!this.hashes.has(key)) this.hashes.set(key, {});
        this.hashes.get(key)![field] = value;
        return 1;
    }

    async hdel(key: string, field: string): Promise<number> {
        const hash = this.hashes.get(key);
        if (hash && hash[field] !== undefined) {
            delete hash[field];
            return 1;
        }
        return 0;
    }

    async hlen(key: string): Promise<number> {
        const hash = this.hashes.get(key);
        return hash ? Object.keys(hash).length : 0;
    }

    async hincrby(key: string, field: string, increment: number): Promise<number> {
        if (!this.hashes.has(key)) this.hashes.set(key, {});
        const hash = this.hashes.get(key)!;
        const current = Number(hash[field] || 0);
        const newVal = current + increment;
        hash[field] = String(newVal);
        return newVal;
    }

    async sadd(key: string, ...members: string[]): Promise<number> {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        const set = this.sets.get(key)!;
        let added = 0;
        for (const member of members) {
            if (!set.has(member)) {
                set.add(member);
                added++;
            }
        }
        return added;
    }

    async srem(key: string, ...members: string[]): Promise<number> {
        const set = this.sets.get(key);
        if (!set) return 0;
        let removed = 0;
        for (const member of members) {
            if (set.delete(member)) removed++;
        }
        return removed;
    }

    async smembers(key: string): Promise<string[]> {
        const set = this.sets.get(key);
        return set ? Array.from(set) : [];
    }

    async sismember(key: string, member: string): Promise<number> {
        const set = this.sets.get(key);
        return set && set.has(member) ? 1 : 0;
    }

    async scard(key: string): Promise<number> {
        const set = this.sets.get(key);
        return set ? set.size : 0;
    }

    async zadd(key: string, score: number, member: string): Promise<number> {
        if (!this.sortedSets.has(key)) this.sortedSets.set(key, new Map());
        this.sortedSets.get(key)!.set(member, Number(score));
        return 1;
    }

    async zrem(key: string, member: string): Promise<number> {
        const zset = this.sortedSets.get(key);
        if (zset && zset.has(member)) {
            zset.delete(member);
            return 1;
        }
        return 0;
    }

    async zrangebyscore(key: string, min: number | string, max: number | string, ...args: any[]): Promise<string[]> {
        const zset = this.sortedSets.get(key);
        if (!zset) return [];
        const results: string[] = [];
        for (const [member, score] of zset.entries()) {
            if (score >= Number(min) && score <= Number(max)) {
                results.push(member);
            }
        }
        results.sort((a, b) => (zset.get(a) || 0) - (zset.get(b) || 0));
        const limitIdx = args.indexOf('LIMIT');
        if (limitIdx !== -1 && args.length > limitIdx + 2) {
            const offset = Number(args[limitIdx + 1]);
            const count = Number(args[limitIdx + 2]);
            return results.slice(offset, offset + count);
        }
        return results;
    }

    pipeline() {
        const commands: any[][] = [];
        const self = this;
        const mockPipe: any = {
            hget: (key: string, field: string) => { commands.push(['hget', key, field]); return mockPipe; },
            sadd: (key: string, ...members: string[]) => { commands.push(['sadd', key, ...members]); return mockPipe; },
            srem: (key: string, ...members: string[]) => { commands.push(['srem', key, ...members]); return mockPipe; },
            scard: (key: string) => { commands.push(['scard', key]); return mockPipe; },
            hset: (key: string, field: string, value: string) => { commands.push(['hset', key, field, value]); return mockPipe; },
            hdel: (key: string, field: string) => { commands.push(['hdel', key, field]); return mockPipe; },
            hincrby: (key: string, field: string, amount: number) => { commands.push(['hincrby', key, field, amount]); return mockPipe; },
            del: (...keys: string[]) => { commands.push(['del', ...keys]); return mockPipe; },
            exec: async () => {
                const results: [Error | null, any][] = [];
                for (const cmd of commands) {
                    const [method, ...args] = cmd;
                    try {
                        const result = await (self as any)[method](...args);
                        results.push([null, result]);
                    } catch (err: unknown) {
                        results.push([err as Error, null]);
                    }
                }
                return results;
            }
        };
        return mockPipe;
    }

    scanStream(opts: ScanStreamOptions) {
        const keys: string[] = [];
        for (const key of this.data.keys()) keys.push(key);
        for (const key of this.sets.keys()) keys.push(key);
        for (const key of this.hashes.keys()) keys.push(key);
        for (const key of this.sortedSets.keys()) keys.push(key);
        const filtered = opts.match ? keys.filter(k => {
            let pattern = opts.match!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            pattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
            return new RegExp(`^${pattern}$`).test(k);
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

    async eval(_script: string, _numKeys: number, ..._args: any[]): Promise<any> {
        return null;
    }

    isReady(): boolean {
        return this.isReadyFlag;
    }

    waitForReady(): Promise<void> {
        return Promise.resolve();
    }
}

// Create the appropriate client
let redis: MockRedis | Redis;
if (isTest) {
    redis = new MockRedis();
} else {
    redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        retryStrategy: (times: number) => {
            if (times > 10) {
                console.error('❌ Redis not available after 10 retries, exiting');
                process.exit(1);
            }
            const delay = Math.min(times * 200, 2000);
            console.log(`🔴 Redis reconnecting in ${delay}ms (attempt ${times})...`);
            return delay;
        },
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        lazyConnect: false,
    });
}

// Track ready state for real Redis
let isReady = false;
let readyResolve: (() => void) | null = null;
const readyPromise = new Promise<void>(resolve => { readyResolve = resolve; });

if (!isTest && redis instanceof Redis) {
    redis.on('connect', () => { /* Connection established */ });
    redis.on('ready', () => {
        isReady = true;
        if (readyResolve) { readyResolve(); readyResolve = null; }
    });
    redis.on('error', (err: Error) => {
        const errWithCode = err as Error & { code?: string };
        if (errWithCode.code === 'ECONNREFUSED') {
            console.error('❌ Redis connection refused - Redis is REQUIRED');
        } else {
            console.error('❌ Redis error:', err.message);
        }
        isReady = false;
    });
    redis.on('close', () => { console.log('🔴 Redis connection closed'); isReady = false; });
}

// Export client with helper methods
const client = redis as any;
client.isReady = () => isTest ? true : isReady;
client.waitForReady = () => isTest ? Promise.resolve() : readyPromise;

export default client;
export { MockRedis };
