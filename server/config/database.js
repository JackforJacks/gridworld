const { Pool } = require('pg');

const pool = new Pool({
    // Connection settings
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gridworld',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,

    // Pool size configuration
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,              // Maximum connections in pool
    min: parseInt(process.env.DB_POOL_MIN, 10) || 2,               // Minimum connections to keep warm

    // Connection lifecycle
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,     // Close idle connections after 30s
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT, 10) || 5000, // Fail if can't connect in 5s

    // Statement timeout to prevent long-running queries
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT, 10) || 30000, // 30s max query time

    // Keep connections alive
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
});

// Pool event logging (only in verbose mode)
const verboseLogs = process.env.VERBOSE_LOGS === 'true';

pool.on('error', (err, client) => {
    console.error('🔴 [Postgres] Unexpected pool error:', err.message);
});

pool.on('connect', (client) => {
    if (verboseLogs) console.log('🟢 [Postgres] New client connected to pool');
});

pool.on('remove', (client) => {
    if (verboseLogs) console.log('🔵 [Postgres] Client removed from pool');
});

// Optional instrumentation for tests/debugging (enable with DEBUG_DB_POOL=true)
const poolInstrumentation = {
    enabled: !!process.env.DEBUG_DB_POOL,
    acquiredClients: new Map(),
};

if (poolInstrumentation.enabled) {
    const origConnect = pool.connect.bind(pool);

    // Support both callback-style and promise-style pool.connect usages
    pool.connect = function (...args) {
        // Callback-style: last argument is a function (err, client, release)
        if (args.length && typeof args[args.length - 1] === 'function') {
            const cb = args.pop();
            return origConnect(...args, (err, client, release) => {
                if (!err && client) {
                    const stack = (new Error()).stack.split('\n').slice(2).join('\n');
                    poolInstrumentation.acquiredClients.set(client, { acquiredAt: Date.now(), stack });
                    const wrappedRelease = function (...rargs) {
                        try { poolInstrumentation.acquiredClients.delete(client); } catch (e) { /* ignore */ }
                        if (typeof release === 'function') return release(...rargs);
                    };
                    cb(null, client, wrappedRelease);
                } else {
                    cb(err, client, release);
                }
            });
        }

        // Promise-style: return a Promise that resolves to the client
        return (async () => {
            const client = await origConnect(...args);
            if (!client) return client;
            const stack = (new Error()).stack.split('\n').slice(2).join('\n');
            poolInstrumentation.acquiredClients.set(client, { acquiredAt: Date.now(), stack });
            const origRelease = client.release && client.release.bind(client);
            client.release = function (...rargs) {
                try { poolInstrumentation.acquiredClients.delete(client); } catch (e) { /* ignore */ }
                if (origRelease) return origRelease(...rargs);
            };
            return client;
        })();
    };

    // Helper to inspect active client diagnostics at teardown
    pool.getActiveClientDiagnostics = () => {
        return Array.from(poolInstrumentation.acquiredClients.values()).map(info => ({ ...info }));
    };
} else {
    pool.getActiveClientDiagnostics = () => [];
}

module.exports = pool;
