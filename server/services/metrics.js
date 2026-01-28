let client;
try {
    client = require('prom-client');
} catch (err) {
    console.warn('[metrics] prom-client not installed — metrics disabled');
    client = null;
}

// Provide no-op fallbacks when prom-client isn't present (helps tests without installing deps)
let auditRunCounter, auditFailures, auditDuration, issuesGauge, lastRunGauge;

if (client) {
    auditRunCounter = new client.Counter({ name: 'integrity_audit_runs_total', help: 'Total number of integrity audits run', labelNames: ['source', 'repair'] });
    auditFailures = new client.Counter({ name: 'integrity_audit_failures_total', help: 'Number of integrity audit runs that reported issues' });
    auditDuration = new client.Histogram({ name: 'integrity_audit_duration_seconds', help: 'Duration of integrity audit runs in seconds', buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60] });
    issuesGauge = new client.Gauge({ name: 'integrity_issues_found', help: 'Number of integrity issues found in the last audit' });
    lastRunGauge = new client.Gauge({ name: 'integrity_audit_last_run_timestamp', help: 'Unix timestamp of last integrity audit run' });
} else {
    // No-op implementations
    auditRunCounter = { inc: () => {} };
    auditFailures = { inc: () => {} };
    auditDuration = { observe: () => {} };
    issuesGauge = { set: () => {} };
    lastRunGauge = { set: () => {} };
}

function init(app) {
    if (!client) {
        // Provide a simple /metrics endpoint that explains metrics are disabled
        app.get('/metrics', (req, res) => res.status(204).send('')); // No content when disabled
        return;
    }

    // Expose default metrics + our custom metrics
    client.collectDefaultMetrics();

    app.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', client.register.contentType);
            const metrics = await client.register.metrics();
            res.end(metrics);
        } catch (err) {
            res.status(500).send('Failed to collect metrics');
        }
    });
    if (process.env.VERBOSE_LOGS === '1' || process.env.VERBOSE_LOGS === 'true') {
        console.log('[metrics] /metrics endpoint enabled');
    }
}

module.exports = {
    init,
    client,
    auditRunCounter,
    auditFailures,
    auditDuration,
    issuesGauge,
    lastRunGauge
};
