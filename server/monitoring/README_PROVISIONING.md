Grafana and Prometheus provisioning (example)

Files in this folder:

- prometheus/integrity-rules.yml
  - Prometheus-style alert rules that trigger on integrity audit failures and issues.

- alertmanager/alertmanager.yml
  - Minimal Alertmanager config with an email receiver (replace with your receiver).

- grafana/provisioning/datasources/prometheus.yml
  - Example Grafana datasource provisioning for a Prometheus instance at http://prometheus:9090

- grafana/provisioning/dashboards/integrity-dashboard.yml
  - Dashboard provisioning provider pointing to a directory where the dashboard JSON is placed.

How to use
----------
1. Prometheus
   - Copy `prometheus/integrity-rules.yml` into your Prometheus rules directory and reload Prometheus (or restart Prometheus):
     - prometheus --config.file=/etc/prometheus/prometheus.yml --web.enable-lifecycle &
     - curl -XPOST http://localhost:9090/-/reload
   - Configure Alertmanager to use `alertmanager/alertmanager.yml` and point Prometheus `alerting` config to your Alertmanager.

2. Grafana provisioning
   - Copy the provisioning files into Grafana's provisioning directories (usually `/etc/grafana/provisioning/datasources` and `/etc/grafana/provisioning/dashboards`).
   - Ensure the dashboards directory `/var/lib/grafana/dashboards/gridworld` exists and contains `integrity-dashboard.json` (this repo contains that file under `server/monitoring/grafana/integrity-dashboard.json`).
   - Restart Grafana to pick up provisioning, or follow Grafana docs to enable provisioning.

Notes
-----
- Update email addresses and Prometheus hosts in the examples to match your environment.
- The Prometheus alert rules rely on the metrics added by this repo (`integrity_audit_failures_total`, `integrity_issues_found`). Adjust thresholds if needed.
- If you prefer Grafana-native alerts, you can also attach alerts directly on dashboard panels. This repo provides Prometheus-style alerts as a portable option.
