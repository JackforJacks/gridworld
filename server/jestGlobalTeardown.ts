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
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.warn('🧹 Global teardown: pool.end() threw:', errMsg);
            }
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('🧹 Global teardown: failed to close Postgres pool:', errMsg);
    }

    // Diagnostic: log any remaining active handles and requests to help find Jest open-handle warnings
    try {
        const proc = process as NodeJS.Process & { _getActiveHandles?: () => unknown[]; _getActiveRequests?: () => unknown[] };
        const handles = (proc._getActiveHandles && proc._getActiveHandles()) || [];
        const requests = (proc._getActiveRequests && proc._getActiveRequests()) || [];

        const summarize = (arr: unknown[]) => arr.map((h: any) => {
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
            } catch (err: unknown) { /* ignore introspection errors */ }
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
        } catch (e: unknown) { /* ignore */ }

        // Try to gracefully close/destroy any remaining handles we can identify
        for (const h of handles) {
            try {
                if (!h) continue;
                const handle = h as any;
                const ctor = handle.constructor && handle.constructor.name ? handle.constructor.name : typeof handle;
                // Destroy leftover sockets
                if ((ctor === 'Socket' || ctor === 'TCPSocket' || ctor === 'TCP') && typeof handle.destroy === 'function') {
                    try {
                        // Avoid force-destroying Postgres client sockets (port 5432) as this can trigger unhandled
                        // 'error' events in the pg client. Instead, prefer graceful pool.end() which is performed
                        // earlier. If the socket is not Postgres, destroy it.
                        const port = (handle._peername && handle._peername.port) || handle.remotePort || null;
                        if (port === 5432) {
                            console.log('🧩 Teardown: skipping destroy of Postgres socket to avoid unhandled errors');
                        } else {
                            handle.destroy();
                            console.log(`🧩 Teardown: destroyed socket (${ctor})`);
                        }
                    } catch (e: unknown) { /* ignore */ }
                }
                // End stray WriteStreams (but avoid closing stdout/stderr)
                if (ctor === 'WriteStream') {
                    if (handle !== process.stdout && handle !== process.stderr) {
                        try { if (typeof handle.end === 'function') { handle.end(); console.log('🧩 Teardown: ended WriteStream'); } } catch (e: unknown) { /* ignore */ }
                    }
                }
                // Close http/https agent sockets
                try {
                    const http = require('http');
                    if (http && http.globalAgent && typeof http.globalAgent.destroy === 'function') {
                        http.globalAgent.destroy();
                        console.log('🧩 Teardown: destroyed http.globalAgent sockets');
                    }
                } catch (e: unknown) { /* ignore */ }

                try {
                    const https = require('https');
                    if (https && https.globalAgent && typeof https.globalAgent.destroy === 'function') {
                        https.globalAgent.destroy();
                        console.log('🧩 Teardown: destroyed https.globalAgent sockets');
                    }
                } catch (e: unknown) { /* ignore */ }

                // If this looks like a Redis client, try to disconnect
                try {
                    const ctorName = ctor;
                    if ((ctorName === 'Redis' || ctorName === 'RedisClient' || ctorName === 'EventEmitter') && typeof handle.disconnect === 'function') {
                        handle.disconnect();
                        console.log('🧩 Teardown: disconnected Redis client');
                    }
                } catch (e: unknown) { /* ignore */ }
            } catch (err: unknown) {
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

    } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('🧹 Global teardown: failed to enumerate active handles:', errMsg);
    }
};