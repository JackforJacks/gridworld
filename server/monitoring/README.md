Grafana dashboard: Integrity Audit (minimal)

Overview
--------
This folder contains a minimal Grafana dashboard JSON (`integrity-dashboard.json`) to visualize the integrity audit metrics exported by this app's Prometheus endpoint (`/metrics`).

Panels included
---------------
- Integrity Issues (stat): `integrity_issues_found` — the count of issues found in the last audit.
- Audit runs (time series): `rate(integrity_audit_runs_total[5m])` — run rate of audits.
- Audit failures (time series): `rate(integrity_audit_failures_total[5m])` — failure rate.
- Audit duration (time series): average duration calculated from histogram sums & counts.

How to import
-------------
1. Start Grafana and add a Prometheus datasource named **Prometheus** that points to your Prometheus instance.
2. In Grafana, go to **Dashboards → Import**, upload `integrity-dashboard.json` and select your Prometheus datasource.
3. Optionally add a variable for `tile_id` or customize the queries.

Notes
-----
- The dashboard assumes your Prometheus datasource is called "Prometheus" (change when importing if different).
- This is intentionally minimal; you can export/import the dashboard JSON into Git and extend it (variables, alerts, links to logs/traces).
