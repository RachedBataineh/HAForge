import type { StepDefinition } from "../types";

const PG_EXPORTER_VERSION = "0.19.1";
const PG_EXPORTER_URL = `https://github.com/prometheus-community/postgres_exporter/releases/download/v${PG_EXPORTER_VERSION}/postgres_exporter-${PG_EXPORTER_VERSION}.linux-amd64.tar.gz`;
const PG_EXPORTER_DIR = `postgres_exporter-${PG_EXPORTER_VERSION}.linux-amd64`;

export function getPgExporterSteps(): StepDefinition[] {
  return [
    {
      phase: "monitoring",
      stepNumber: 1,
      name: "Create PostgreSQL Monitoring User",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "id postgres_exporter &>/dev/null || sudo useradd --no-create-home --shell /usr/sbin/nologin postgres_exporter",
            "sudo -u postgres psql -c \"DO \\$\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'postgres_exporter') THEN CREATE USER postgres_exporter; END IF; END \\$\\$;\" || true",
            "sudo -u postgres psql -c \"GRANT pg_monitor TO postgres_exporter;\" || true",
            "sudo -u postgres psql -c \"GRANT CONNECT ON DATABASE postgres TO postgres_exporter;\" || true",
          ],
        },
      ],
      files: [],
      validation: "sudo -u postgres psql -c \"SELECT 1 FROM pg_roles WHERE rolname = 'postgres_exporter'\" -tA | grep -q 1 && echo 'OK' || echo 'MISSING'",
    },
    {
      phase: "monitoring",
      stepNumber: 2,
      name: "Download PostgreSQL Exporter",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            `wget -q "${PG_EXPORTER_URL}" -O /tmp/postgres_exporter.tar.gz`,
            `tar xzf /tmp/postgres_exporter.tar.gz -C /tmp/`,
            `sudo cp /tmp/${PG_EXPORTER_DIR}/postgres_exporter /usr/local/bin/postgres_exporter`,
            `sudo chmod +x /usr/local/bin/postgres_exporter`,
            `rm -rf /tmp/postgres_exporter.tar.gz /tmp/${PG_EXPORTER_DIR}`,
          ],
        },
      ],
      files: [],
      validation: "test -f /usr/local/bin/postgres_exporter && echo 'OK' || echo 'MISSING'",
    },
    {
      phase: "monitoring",
      stepNumber: 3,
      name: "Create PostgreSQL Exporter Service",
      targetRole: "all_pg",
      commands: [
        {
          commands: [],
        },
      ],
      files: [
        {
          path: "/etc/systemd/system/postgres_exporter.service",
          content: `[Unit]
Description=PostgreSQL Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=postgres_exporter
Group=postgres_exporter
Type=simple
Environment="DATA_SOURCE_NAME=user=postgres_exporter host=/var/run/postgresql dbname=postgres"
ExecStart=/usr/local/bin/postgres_exporter --web.listen-address=0.0.0.0:9187

[Install]
WantedBy=multi-user.target
`,
        },
      ],
    },
    {
      phase: "monitoring",
      stepNumber: 4,
      name: "Start PostgreSQL Exporter",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo systemctl daemon-reload",
            "sudo systemctl enable postgres_exporter",
            "sudo systemctl restart postgres_exporter",
            "sleep 1",
            "sudo systemctl is-active postgres_exporter",
          ],
        },
      ],
      validation: "curl -sf http://localhost:9187/metrics -o /dev/null && echo 'OK' || echo 'FAILED'",
      files: [],
    },
  ];
}
