import { Pool, PoolClient } from 'pg';

// Extended Pool type with diagnostic methods
interface ExtendedPool extends Pool {
    getActiveClientDiagnostics: () => { acquiredAt: number; stack: string }[];
}

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gridworld',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10),
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000', 10),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
}) as ExtendedPool;

// Pool event logging
const verboseLogs = process.env.VERBOSE_LOGS === 'true';

pool.on('error', (err: Error) => {
    console.error('🔴 [Postgres] Unexpected pool error:', err.message);
});

pool.on('connect', () => {
    if (verboseLogs) console.log('🟢 [Postgres] New client connected to pool');
});

pool.on('remove', () => {
    if (verboseLogs) console.log('🔵 [Postgres] Client removed from pool');
});

// Optional instrumentation for tests/debugging
interface ClientInfo {
    acquiredAt: number;
    stack: string;
}

const poolInstrumentation = {
    enabled: !!process.env.DEBUG_DB_POOL,
    acquiredClients: new Map<PoolClient, ClientInfo>(),
};

if (poolInstrumentation.enabled) {
    const origConnect = pool.connect.bind(pool);

    (pool as any).connect = function (...args: any[]) {
        if (args.length && typeof args[args.length - 1] === 'function') {
            const cb = args.pop();
            return origConnect((err: Error | undefined, client: PoolClient | undefined, release: (releaseErr?: any) => void) => {
                if (!err && client) {
                    const stack = (new Error()).stack?.split('\n').slice(2).join('\n') || '';
                    poolInstrumentation.acquiredClients.set(client, { acquiredAt: Date.now(), stack });
                    const wrappedRelease = function (...rargs: any[]) {
                        try { poolInstrumentation.acquiredClients.delete(client); } catch { /* ignore */ }
                        if (typeof release === 'function') return (release as any)(...rargs);
                    };
                    cb(null, client, wrappedRelease);
                } else {
                    cb(err, client, release);
                }
            });
        }

        return (async () => {
            const client = await origConnect();
            if (!client) return client;
            const stack = (new Error()).stack?.split('\n').slice(2).join('\n') || '';
            poolInstrumentation.acquiredClients.set(client, { acquiredAt: Date.now(), stack });
            const origRelease = client.release?.bind(client);
            (client as any).release = function (...rargs: any[]) {
                try { poolInstrumentation.acquiredClients.delete(client); } catch { /* ignore */ }
                if (origRelease) return origRelease(...rargs);
            };
            return client;
        })();
    };

    pool.getActiveClientDiagnostics = () => {
        return Array.from(poolInstrumentation.acquiredClients.values()).map(info => ({ ...info }));
    };
} else {
    pool.getActiveClientDiagnostics = () => [];
}

export default pool;
export type { ExtendedPool };
