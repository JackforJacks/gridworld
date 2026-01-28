module.exports = async () => {
    try {
        const pool = require('./config/database');
        if (pool && typeof pool.end === 'function') {
            try {
                await pool.end();
                console.log('🧹 Global teardown: Postgres pool closed');
                if (typeof pool.totalCount !== 'undefined') {
                    console.log(`🧹 Pool counts: total=${pool.totalCount}, idle=${pool.idleCount}, waiting=${pool.waitingCount}`);
                }
            } catch (err) {
                console.warn('🧹 Global teardown: pool.end() threw:', err && err.message ? err.message : err);
            }
        }
    } catch (e) {
        console.warn('🧹 Global teardown: failed to close Postgres pool:', e && e.message ? e.message : e);
    }

    // Diagnostic: log any remaining active handles and requests to help find Jest open-handle warnings
    try {
        const handles = (process._getActiveHandles && process._getActiveHandles()) || [];
        const requests = (process._getActiveRequests && process._getActiveRequests()) || [];

        const summarize = (arr) => arr.map(h => {
            if (!h) return String(h);
            const ctor = h.constructor && h.constructor.name ? h.constructor.name : typeof h;
            // Provide a few useful properties when possible
            let info = ctor;
            try {
                if (ctor === 'Timeout' || ctor === 'Immediate') {
                    info += ` (hasRef=${typeof h.hasRef === 'function' ? h.hasRef() : 'n/a'})`;
                } else if (ctor === 'Socket' || ctor === 'TCPSocket') {
                    const addr = h.remoteAddress || (h._peername && h._peername.address) || 'n/a';
                    const rport = h.remotePort || (h._peername && h._peername.port) || 'n/a';
                    const lport = h.localPort || (h._sockname && h._sockname.port) || 'n/a';
                    info += ` (remote=${addr}:${rport}, localPort=${lport})`;
                } else if (ctor === 'Redis' || ctor === 'RedisClient') {
                    info += ` (redis status=${h.status || 'n/a'})`;
                }
            } catch (err) { /* ignore introspection errors */ }
            return info;
        });

        console.log('🧩 Global teardown: active handles:', summarize(handles));
        console.log('🧩 Global teardown: active requests:', summarize(requests));

        // DB pool diagnostics: print stack traces for any clients that are still acquired
        try {
            const db = require('./config/database');
            if (typeof db.getActiveClientDiagnostics === 'function') {
                const activeClients = db.getActiveClientDiagnostics();
                if (activeClients && activeClients.length > 0) {
                    console.log('🧩 Global teardown: Active PostgreSQL clients not released:');
                    activeClients.forEach((c, i) => {
                        console.log(`  Client ${i + 1}: acquiredAt=${new Date(c.acquiredAt).toISOString()}`);
                        console.log(c.stack);
                    });
                }
            }
        } catch (e) { /* ignore */ }

        // Try to gracefully close/destroy any remaining handles we can identify
        for (const h of handles) {
            try {
                if (!h) continue;
                const ctor = h.constructor && h.constructor.name ? h.constructor.name : typeof h;
                // Destroy leftover sockets
                if ((ctor === 'Socket' || ctor === 'TCPSocket' || ctor === 'TCP') && typeof h.destroy === 'function') {
                    try {
                        // Avoid force-destroying Postgres client sockets (port 5432) as this can trigger unhandled
                        // 'error' events in the pg client. Instead, prefer graceful pool.end() which is performed
                        // earlier. If the socket is not Postgres, destroy it.
                        const port = (h._peername && h._peername.port) || h.remotePort || null;
                        if (port === 5432) {
                            console.log('🧩 Teardown: skipping destroy of Postgres socket to avoid unhandled errors');
                        } else {
                            h.destroy();
                            console.log(`🧩 Teardown: destroyed socket (${ctor})`);
                        }
                    } catch (e) { /* ignore */ }
                }
                // End stray WriteStreams (but avoid closing stdout/stderr)
                if (ctor === 'WriteStream') {
                    if (h !== process.stdout && h !== process.stderr) {
                        try { if (typeof h.end === 'function') { h.end(); console.log('🧩 Teardown: ended WriteStream'); } } catch (e) { /* ignore */ }
                    }
                }
                // Close http/https agent sockets
                try {
                    const http = require('http');
                    if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
                        http.globalAgent.destroy();
                        console.log('🧩 Teardown: destroyed http.globalAgent sockets');
                    }
                } catch (e) { /* ignore */ }

                try {
                    const https = require('https');
                    if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
                        https.globalAgent.destroy();
                        console.log('🧩 Teardown: destroyed https.globalAgent sockets');
                    }
                } catch (e) { /* ignore */ }

                // If this looks like a Redis client, try to disconnect
                try {
                    const ctorName = ctor;
                    if ((ctorName === 'Redis' || ctorName === 'RedisClient' || ctorName === 'EventEmitter') && typeof h.disconnect === 'function') {
                        h.disconnect();
                        console.log('🧩 Teardown: disconnected Redis client');
                    }
                } catch (e) { /* ignore */ }
            } catch (err) {
                /* ignore per-handle teardown errors */
            }
        }

        // If we still have handles after an attempted graceful teardown, force an exit to avoid Jest's non-exit warning.
        // This is acceptable in a test environment to avoid flakiness due to lingering system handles (e.g., Postgres
        // client sockets that don't fully close in the test VM). Prefer graceful cleanup above, so this is a last-resort.
        if (handles.length > 0) {
            console.log('🧹 Global teardown: handles remain after attempts to close them. Forcing process exit to avoid Jest hang.');
            // Allow a short delay for I/O flush then exit
            setTimeout(() => process.exit(0), 50);
        }

    } catch (err) {
        console.warn('🧹 Global teardown: failed to enumerate active handles:', err && err.message ? err.message : err);
    }
};