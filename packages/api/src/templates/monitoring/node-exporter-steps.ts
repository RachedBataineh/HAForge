import type { StepDefinition } from "../types";

const NODE_EXPORTER_VERSION = "1.11.1";
const NODE_EXPORTER_URL = `https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz`;
const NODE_EXPORTER_DIR = `node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64`;

export function getMonitoringSteps(): StepDefinition[] {
  return [
    {
      phase: "monitoring",
      stepNumber: 1,
      name: "Download Node Exporter",
      targetRole: "all",
      commands: [
        {
          commands: [
            `wget -q "${NODE_EXPORTER_URL}" -O /tmp/node_exporter.tar.gz`,
            `tar xzf /tmp/node_exporter.tar.gz -C /tmp/`,
            `sudo cp /tmp/${NODE_EXPORTER_DIR}/node_exporter /usr/local/bin/node_exporter`,
            `sudo chmod +x /usr/local/bin/node_exporter`,
            `rm -rf /tmp/node_exporter.tar.gz /tmp/${NODE_EXPORTER_DIR}`,
          ],
        },
      ],
      files: [],
      validation: "test -f /usr/local/bin/node_exporter && echo 'OK' || echo 'MISSING'",
    },
    {
      phase: "monitoring",
      stepNumber: 2,
      name: "Create Node Exporter Service",
      targetRole: "all",
      commands: [
        {
          commands: [
            "id node_exporter &>/dev/null || sudo useradd --no-create-home --shell /usr/sbin/nologin node_exporter",
          ],
        },
      ],
      files: [
        {
          path: "/etc/systemd/system/node_exporter.service",
          content: `[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
`,
        },
      ],
    },
    {
      phase: "monitoring",
      stepNumber: 3,
      name: "Start Node Exporter",
      targetRole: "all",
      commands: [
        {
          commands: [
            "sudo systemctl daemon-reload",
            "sudo systemctl enable node_exporter",
            "sudo systemctl start node_exporter",
            "sleep 1",
            "sudo systemctl is-active node_exporter",
          ],
        },
      ],
      validation: "curl -sf http://localhost:9100/metrics -o /dev/null && echo 'OK' || echo 'FAILED'",
      files: [],
    },
  ];
}
