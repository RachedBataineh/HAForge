import type { StepDefinition } from "../types";
import { haproxyConfigContent, CHECK_HAPROXY_SCRIPT, NETPLAN_FLOATING_IP } from "./haproxy-config";
import { keepalivedConfigContent, failoverScriptContent, keepalivedEnvContent } from "./keepalived-config";

export function getHaproxySteps(): StepDefinition[] {
  return [
    {
      phase: "haproxy",
      stepNumber: 1,
      name: "Install HAProxy and keepalived",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo apt update",
            "sudo apt -y install haproxy keepalived socat",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 2,
      name: "Verify CA certificate for backend verification",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "ls -la /etc/haproxy/ca.crt",
            "sudo openssl x509 -in /etc/haproxy/ca.crt -text -noout | head -5",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 3,
      name: "Configure HAProxy",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo haproxy -c -f /etc/haproxy/haproxy.cfg",
            "sudo systemctl enable haproxy",
            "sudo systemctl restart haproxy",
            "echo '--- HAProxy status ---'",
            "sudo systemctl status haproxy --no-pager || true",
          ],
        },
      ],
      files: [
        {
          path: "/etc/haproxy/haproxy.cfg",
          content: `global
    log /dev/log local0
    maxconn 4096
    stats socket /run/haproxy/admin.sock mode 660 level admin
    hard-stop-after 30s

defaults
    log global
    mode tcp
    option tcpka
    option clitcpka
    option srvtcpka
    retries 3
    timeout connect 5s
    timeout client 30s
    timeout server 30s

${haproxyConfigContent()}
`,
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 4,
      name: "Create HAProxy health check script",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo mkdir -p /etc/keepalived",
            "sudo chmod +x /etc/keepalived/check_haproxy.sh",
          ],
        },
      ],
      files: [
        {
          path: "/etc/keepalived/check_haproxy.sh",
          content: CHECK_HAPROXY_SCRIPT,
          permissions: "755",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 5,
      name: "Configure keepalived (HAProxy 1 - MASTER, priority 100)",
      targetRole: "haproxy_1",
      commands: [],
      files: [
        {
          path: "/etc/keepalived/keepalived.conf",
          content: keepalivedConfigContent("MASTER", 100, "${PRIVATE_IP_HAPROXY_1}", ["${PRIVATE_IP_HAPROXY_2}", "${PRIVATE_IP_HAPROXY_3}"]),
        },
        {
          path: "/etc/keepalived/failover.sh",
          content: failoverScriptContent(),
          permissions: "700",
        },
        {
          path: "/etc/keepalived/.env",
          content: keepalivedEnvContent("${SERVER_ID_1}"),
          owner: "root:root",
          permissions: "600",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 6,
      name: "Configure keepalived (HAProxy 2 - BACKUP, priority 90)",
      targetRole: "haproxy_2",
      commands: [],
      files: [
        {
          path: "/etc/keepalived/keepalived.conf",
          content: keepalivedConfigContent("BACKUP", 90, "${PRIVATE_IP_HAPROXY_2}", ["${PRIVATE_IP_HAPROXY_1}", "${PRIVATE_IP_HAPROXY_3}"]),
        },
        {
          path: "/etc/keepalived/failover.sh",
          content: failoverScriptContent(),
          permissions: "700",
        },
        {
          path: "/etc/keepalived/.env",
          content: keepalivedEnvContent("${SERVER_ID_2}"),
          owner: "root:root",
          permissions: "600",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 7,
      name: "Configure keepalived (HAProxy 3 - BACKUP, priority 80)",
      targetRole: "haproxy_3",
      commands: [],
      files: [
        {
          path: "/etc/keepalived/keepalived.conf",
          content: keepalivedConfigContent("BACKUP", 80, "${PRIVATE_IP_HAPROXY_3}", ["${PRIVATE_IP_HAPROXY_1}", "${PRIVATE_IP_HAPROXY_2}"]),
        },
        {
          path: "/etc/keepalived/failover.sh",
          content: failoverScriptContent(),
          permissions: "700",
        },
        {
          path: "/etc/keepalived/.env",
          content: keepalivedEnvContent("${SERVER_ID_3}"),
          owner: "root:root",
          permissions: "600",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 8,
      name: "Assign Floating IP to HAProxy 1 via Hetzner API",
      targetRole: "haproxy_1",
      commands: [
        {
          commands: [
            "echo 'Assigning Floating IP via Hetzner API to HAProxy 1...'",
            "RESPONSE=$(curl -s -w '\\n%{http_code}' -X POST -H \"Authorization: Bearer ${HETZNER_API_TOKEN}\" -H \"Content-Type: application/json\" -d '{\"server\": ${SERVER_ID_1}}' \"https://api.hetzner.cloud/v1/floating_ips/${FLOATING_IP_ID}/actions/assign\")",
            "HTTP_CODE=$(echo \"$RESPONSE\" | tail -1)",
            "BODY=$(echo \"$RESPONSE\" | sed '$d')",
            "echo \"HTTP $HTTP_CODE\"",
            "echo \"$BODY\"",
            "if [ \"$HTTP_CODE\" -ne 200 ] && [ \"$HTTP_CODE\" -ne 201 ]; then",
            "  echo 'ERROR: Failed to assign floating IP'",
            "  exit 1",
            "fi",
            "sleep 5",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 9,
      name: "Configure floating IP via netplan on all HAProxy nodes",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "echo 'Applying netplan to bind Floating IP...'",
            "sudo netplan apply || true",
            "echo '--- Network interfaces ---'",
            "ip addr show enp7s0 | grep inet || true",
          ],
        },
      ],
      files: [
        {
          path: "/etc/netplan/60-floating-ip.yaml",
          content: NETPLAN_FLOATING_IP,
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 10,
      name: "Start keepalived on all HAProxy nodes",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo systemctl enable keepalived",
            "sudo systemctl start keepalived",
            "sleep 3",
            "echo '--- Keepalived status ---'",
            "sudo systemctl status keepalived --no-pager || true",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 11,
      name: "Verify HAProxy + keepalived + floating IP",
      targetRole: "haproxy_1",
      commands: [
        {
          commands: [
            "echo '=== HAProxy ==='",
            "sudo systemctl status haproxy | head -5",
            "echo '=== Keepalived ==='",
            "sudo systemctl status keepalived | head -5",
            "echo '=== Keepalived state ==='",
            "sudo journalctl -u keepalived --no-pager -n 20 | grep -i 'entering' || true",
            "echo '=== Floating IP on interface ==='",
            "ip addr show enp7s0 | grep ${FLOATING_IP} || echo 'WARNING: Floating IP NOT found on interface!'",
            "echo '=== HAProxy backend check ==='",
            "echo 'show stat' | sudo socat stdio /run/haproxy/admin.sock 2>/dev/null | grep postgresql | cut -d',' -f1,2,18 || echo 'Stats socket not available'",
          ],
        },
      ],
      files: [],
    },
  ];
}
