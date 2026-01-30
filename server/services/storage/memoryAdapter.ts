// Simple in-memory adapter that mimics a subset of ioredis API used by the app

/** Type for hash storage: key -> field -> value */
type HashStore = Record<string, Record<string, string>>;

/** Type for set storage: key -> Set of members */
type SetStore = Record<string, Set<string>>;

/** Type for key-value storage */
type KVStore = Record<string, string>;

/** Type for sorted set storage: key -> Map of member -> score */
type ZSetStore = Record<string, Map<string, number>>;

/** Pipeline operation tuple */
type PipelineOp = [string, ...string[]];

/** Pipeline execution result */
type PipelineResult = [null, string | number | string[] | null];

/** Store interface for Pipeline access */
interface MemoryStore {
    hashes: HashStore;
    sets: SetStore;
    kv: KVStore;
    zsets: ZSetStore;
}

/** Options for scanStream */
interface ScanStreamOptions {
    match?: string;
    count?: number;
}

class Pipeline {
    private ops: PipelineOp[];
    private store: MemoryStore;

    constructor(store: MemoryStore) {
        this.ops = [];
        this.store = store;
    }

    hset(key: string, field: string, value: string): this {
        this.ops.push(['hset', key, field, value]);
        return this;
    }

    hget(key: string, field: string): this {
        this.ops.push(['hget', key, field]);
        return this;
    }

    sadd(key: string, member: string): this {
        this.ops.push(['sadd', key, member]);
        return this;
    }

    srem(key: string, member: string): this {
        this.ops.push(['srem', key, member]);
        return this;
    }

    hdel(key: string, field: string): this {
        this.ops.push(['hdel', key, field]);
        return this;
    }

    scard(key: string): this {
        this.ops.push(['scard', key]);
        return this;
    }

    smembers(key: string): this {
        this.ops.push(['smembers', key]);
        return this;
    }

    get(key: string): this {
        this.ops.push(['get', key]);
        return this;
    }

    set(key: string, value: string): this {
        this.ops.push(['set', key, value]);
        return this;
    }

    async exec(): Promise<PipelineResult[]> {
        const results: PipelineResult[] = [];
        for (const op of this.ops) {
            const [cmd, ...args] = op;
            let res: string | number | string[] | null;
            if (cmd === 'hset') {
                const [k, f, v] = args; this.store.hashes[k] ||= {}; this.store.hashes[k][f] = v; res = 1;
            } else if (cmd === 'hget') {
                const [k, f] = args; res = (this.store.hashes[k] || {})[f] ?? null;
            } else if (cmd === 'sadd') {
                const [k, m] = args; this.store.sets[k] ||= new Set<string>(); this.store.sets[k].add(m); res = 1;
            } else if (cmd === 'srem') {
                const [k, m] = args; const s = this.store.sets[k]; res = s ? (s.delete(m) ? 1 : 0) : 0;
            } else if (cmd === 'smembers') {
                const [k] = args; const s = this.store.sets[k]; res = s ? Array.from(s) : [];
            } else if (cmd === 'hdel') {
                const [k, f] = args; const h = this.store.hashes[k]; res = h && Object.prototype.hasOwnProperty.call(h, f) ? (delete h[f], 1) : 0;
            } else if (cmd === 'scard') {
                const [k] = args; const s = this.store.sets[k]; res = s ? s.size : 0;
            } else if (cmd === 'get') {
                const [k] = args; res = this.store.kv[k] ?? null;
            } else if (cmd === 'set') {
                const [k, v] = args; this.store.kv[k] = v; res = 'OK';
            } else if (cmd === 'incr') {
                const [k] = args; const current = parseInt(this.store.kv[k] || '0', 10); const newVal = current + 1; this.store.kv[k] = newVal.toString(); res = newVal;
            } else {
                res = null;
            }
            results.push([null, res]);
        }
        return results;
    }
}

class MemoryAdapter implements MemoryStore {
    hashes: HashStore;
    sets: SetStore;
    kv: KVStore;
    zsets: ZSetStore;

    constructor() {
        this.hashes = Object.create(null);
        this.sets = Object.create(null);
        this.kv = Object.create(null);
        this.zsets = Object.create(null);
    }

    isAvailable(): boolean {
        return true; // Always available in-memory (for tests/dev)
    }

    clear(): void {
        this.hashes = Object.create(null);
        this.sets = Object.create(null);
        this.kv = Object.create(null);
        this.zsets = Object.create(null);
    }

    pipeline(): Pipeline {
        return new Pipeline(this);
    }

    async hgetall(key: string): Promise<Record<string, string>> {
        const obj = this.hashes[key] || {};
        // return a shallow copy
        const copy: Record<string, string> = {};
        for (const k of Object.keys(obj)) copy[k] = obj[k];
        return copy;
    }

    async hget(key: string, field: string): Promise<string | null> {
        return (this.hashes[key] || {})[field] ?? null;
    }

    async hset(key: string, field: string, val: string): Promise<number> {
        this.hashes[key] ||= {};
        this.hashes[key][field] = val;
        return 1;
    }

    async del(...keys: string[]): Promise<number> {
        let deleted = 0;
        for (const k of keys) {
            if (this.hashes[k]) { delete this.hashes[k]; deleted++; }
            if (this.kv[k]) { delete this.kv[k]; deleted++; }
            if (this.sets[k]) { delete this.sets[k]; deleted++; }
        }
        return deleted;
    }

    async scard(key: string): Promise<number> {
        const s = this.sets[key];
        return s ? s.size : 0;
    }

    async sadd(key: string, member: string): Promise<number> {
        this.sets[key] ||= new Set<string>();
        this.sets[key].add(member);
        return 1;
    }

    async srem(key: string, member: string): Promise<number> {
        const s = this.sets[key];
        if (!s) return 0;
        const had = s.delete(member);
        if (s.size === 0) delete this.sets[key];
        return had ? 1 : 0;
    }

    async smembers(key: string): Promise<string[]> {
        const s = this.sets[key];
        return s ? Array.from(s) : [];
    }

    async sismember(key: string, member: string | number): Promise<number> {
        const s = this.sets[key];
        return s ? (s.has(String(member)) ? 1 : 0) : 0;
    }

    async hincrby(key: string, field: string, amount: number | string): Promise<number> {
        this.hashes[key] ||= {};
        const current = parseInt(this.hashes[key][field] || '0', 10);
        const newVal = current + Number(amount);
        this.hashes[key][field] = newVal.toString();
        return newVal;
    }

    async incr(key: string): Promise<number> {
        const current = parseInt(this.kv[key] || '0', 10);
        const newVal = current + 1;
        this.kv[key] = newVal.toString();
        return newVal;
    }

    async get(key: string): Promise<string | null> {
        return this.kv[key] ?? null;
    }

    async set(key: string, value: string): Promise<string> {
        this.kv[key] = value;
        return 'OK';
    }

    async hdel(key: string, field: string): Promise<number> {
        const h = this.hashes[key];
        if (!h || !(field in h)) return 0;
        delete h[field];
        return 1;
    }

    async zadd(key: string, score: number | string, member: string | number): Promise<number> {
        this.zsets[key] ||= new Map<string, number>();
        this.zsets[key].set(String(member), Number(score));
        return 1;
    }

    async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
        const map = this.zsets[key];
        if (!map) return [];
        const entries = Array.from(map.entries()).filter(([_m, s]) => s >= Number(min) && s <= Number(max));
        entries.sort((a, b) => a[1] - b[1]);
        return entries.map(([m]) => m);
    }

    async zrem(key: string, member: string | number): Promise<number> {
        const map = this.zsets[key];
        if (!map) return 0;
        const had = map.delete(String(member));
        if (map.size === 0) delete this.zsets[key];
        return had ? 1 : 0;
    }

    async keys(pattern: string = '*'): Promise<string[]> {
        const allKeys = new Set<string>([...Object.keys(this.kv), ...Object.keys(this.hashes), ...Object.keys(this.sets), ...Object.keys(this.zsets)]);
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return Array.from(allKeys).filter(k => regex.test(k));
    }

    scanStream(options: ScanStreamOptions = {}): AsyncIterable<string[]> {
        const { match = '*', count = 100 } = options;
        // Return an async iterable that yields arrays of keys matching the glob
        const allKeys = new Set<string>([...Object.keys(this.kv), ...Object.keys(this.hashes), ...Object.keys(this.sets), ...Object.keys(this.zsets)]);
        const pattern = new RegExp('^' + match.replace(/\*/g, '.*') + '$');
        const matches = Array.from(allKeys).filter(k => pattern.test(k));
        let index = 0;
        return {
            async *[Symbol.asyncIterator](): AsyncGenerator<string[]> {
                while (index < matches.length) {
                    const chunk = matches.slice(index, index + count);
                    index += count;
                    yield chunk;
                }
            }
        };
    }
}

export default MemoryAdapter;
