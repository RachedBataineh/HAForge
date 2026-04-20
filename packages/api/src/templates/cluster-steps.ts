export type TargetRole =
  | "all_pg"
  | "all_ha"
  | "postgresql_1"
  | "postgresql_2"
  | "postgresql_3"
  | "haproxy_1"
  | "haproxy_2"
  | "haproxy_3";

export interface CommandStep {
  commands: string[];
}

export interface FileStep {
  path: string;
  content: string;
  owner?: string;
  permissions?: string;
}

export interface StepDefinition {
  phase: "postgres" | "haproxy";
  stepNumber: number;
  name: string;
  targetRole: TargetRole;
  commands: CommandStep[];
  files: FileStep[];
  validation?: string;
}

// --- Helper to build per-node etcd.env content ---
// Uses PRIVATE IPs for all etcd peer/client communication
function etcdEnvContent(
  nodeName: string,
  selfPrivateIp: string,
  _ip1: string,
  _ip2: string,
  _ip3: string,
  nodeNum: number,
) {
  return `ETCD_NAME="${nodeName}"
ETCD_DATA_DIR="/var/lib/etcd"
ETCD_INITIAL_CLUSTER="postgresql-01=https://\${PRIVATE_IP_NODE_1}:2380,postgresql-02=https://\${PRIVATE_IP_NODE_2}:2380,postgresql-03=https://\${PRIVATE_IP_NODE_3}:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="etcd-cluster"
ETCD_INITIAL_ADVERTISE_PEER_URLS="https://${selfPrivateIp}:2380"
ETCD_LISTEN_PEER_URLS="https://0.0.0.0:2380"
ETCD_LISTEN_CLIENT_URLS="https://0.0.0.0:2379"
ETCD_ADVERTISE_CLIENT_URLS="https://${selfPrivateIp}:2379"
ETCD_CLIENT_CERT_AUTH="true"
ETCD_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_CERT_FILE="/etc/etcd/ssl/etcd-node${nodeNum}.crt"
ETCD_KEY_FILE="/etc/etcd/ssl/etcd-node${nodeNum}.key"
ETCD_PEER_CLIENT_CERT_AUTH="true"
ETCD_PEER_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_PEER_CERT_FILE="/etc/etcd/ssl/etcd-node${nodeNum}.crt"
ETCD_PEER_KEY_FILE="/etc/etcd/ssl/etcd-node${nodeNum}.key"`;
}

// --- Helper to build per-node patroni config ---
// Uses PRIVATE IPs for etcd hosts, connect_address, and pg_hba
function patroniConfigContent(
  nodeName: string,
  selfPrivateIp: string,
  privateIp1: string,
  privateIp2: string,
  privateIp3: string,
  nodeNum: number,
) {
  return `scope: postgresql-cluster
namespace: /service/
name: ${nodeName}

etcd3:
  hosts: ${privateIp1}:2379,${privateIp2}:2379,${privateIp3}:2379
  protocol: https
  cacert: /etc/etcd/ssl/ca.crt
  cert: /etc/etcd/ssl/etcd-node${nodeNum}.crt
  key: /etc/etcd/ssl/etcd-node${nodeNum}.key

restapi:
  listen: 0.0.0.0:8008
  connect_address: ${selfPrivateIp}:8008
  certfile: /var/lib/postgresql/ssl/server.pem

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      parameters:
        ssl: 'on'
        ssl_cert_file: /var/lib/postgresql/ssl/server.crt
        ssl_key_file: /var/lib/postgresql/ssl/server.key
      pg_hba:
        - hostssl replication replicator 127.0.0.1/32 md5
        - hostssl replication replicator ${privateIp1}/32 md5
        - hostssl replication replicator ${privateIp2}/32 md5
        - hostssl replication replicator ${privateIp3}/32 md5
        - hostssl all all 127.0.0.1/32 md5
        - hostssl all all 0.0.0.0/0 md5
        - host all all 0.0.0.0/0 md5
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${selfPrivateIp}:5432
  data_dir: /var/lib/postgresql/data
  bin_dir: /usr/lib/postgresql/17/bin
  authentication:
    superuser:
      username: postgres
      password: \${SUPERUSER_PASSWORD}
    replication:
      username: replicator
      password: \${REPLICATION_PASSWORD}
  parameters:
    max_connections: 100
    shared_buffers: 256MB

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false`;
}

// --- HAProxy config template (uses PG private IPs) ---
function haproxyConfigContent() {
  return `frontend postgres_frontend
    bind *:5432
    mode tcp
    default_backend postgres_backend

backend postgres_backend
    mode tcp
    option tcp-check
    option httpchk GET /primary
    http-check expect status 200
    timeout connect 5s
    timeout client 30s
    timeout server 30s
    server postgresql-01 \${PRIVATE_IP_NODE_1}:5432 port 8008 check check-ssl verify none
    server postgresql-02 \${PRIVATE_IP_NODE_2}:5432 port 8008 check check-ssl verify none
    server postgresql-03 \${PRIVATE_IP_NODE_3}:5432 port 8008 check check-ssl verify none
`;
}

// --- Keepalived config template (unicast VRRP for Hetzner) ---
function keepalivedConfigContent(
  state: string,
  priority: number,
  privateIp: string,
  peerIps: string[],
) {
  const peers = peerIps.map(ip => `        ${ip}`).join("\n");
  return `global_defs {
    enable_script_security
    script_user root
}

vrrp_script check_haproxy {
    script "/etc/keepalived/check_haproxy.sh"
    interval 2
    fall 3
    rise 2
}

vrrp_instance VI_1 {
    state ${state}
    interface enp7s0
    virtual_router_id 51
    priority ${priority}
    advert_int 1

    unicast_src_ip ${privateIp}
    unicast_peer {
${peers}
    }

    authentication {
        auth_type PASS
        auth_pass HAForgeCluster
    }

    virtual_ipaddress {
        \${FLOATING_IP}/32 dev eth0
    }

    track_script {
        check_haproxy
    }

    notify_master /etc/keepalived/failover.sh
}`;
}

// --- Failover script (called by keepalived notify_master) ---
function failoverScriptContent(myServerId: string) {
  return `#!/bin/bash
HETZNER_TOKEN="\${HETZNER_API_TOKEN}"
FLOATING_IP_ID="\${FLOATING_IP_ID}"
MY_SERVER_ID="${myServerId}"

echo "$(date): notify_master fired - assigning floating IP to ${myServerId}" >> /var/log/keepalived-failover.log

curl -s -X POST \\
  "https://api.hetzner.cloud/v1/floating_ips/\${FLOATING_IP_ID}/actions/assign" \\
  -H "Authorization: Bearer \${HETZNER_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"server\\": \${MY_SERVER_ID}}" >> /var/log/keepalived-failover.log 2>&1`;
}

// --- HAProxy health check script (used by keepalived track_script) ---
const CHECK_HAPROXY_SCRIPT = `#!/bin/bash
if ! pidof haproxy > /dev/null; then
    exit 1
fi
if ! ss -ltn | grep -q ":5432"; then
    exit 1
fi
exit 0`;

// --- etcd systemd service ---
const ETCD_SERVICE = `[Unit]
Description=etcd key-value store
Documentation=https://github.com/etcd-io/etcd
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
WorkingDirectory=/var/lib/etcd
EnvironmentFile=/etc/etcd/etcd.env
ExecStart=/usr/local/bin/etcd
Restart=always
RestartSec=10s
LimitNOFILE=40000
User=etcd
Group=etcd

[Install]
WantedBy=multi-user.target`;

// --- Netplan config for floating IP ---
const NETPLAN_FLOATING_IP = `network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - \${FLOATING_IP}/32
`;

export function getClusterSteps(): StepDefinition[] {
  return getHaProxySteps();
}

export function getLbClusterSteps(): StepDefinition[] {
  // Only PG steps (1-19) for Hetzner LB mode, no HAProxy/keepalived steps
  return getHaProxySteps().filter((s) => s.phase === "postgres");
}

function getHaProxySteps(): StepDefinition[] {
  return [
    // ==================== PHASE 1: PostgreSQL ====================
    {
      phase: "postgres",
      stepNumber: 1,
      name: "Install PostgreSQL",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo apt update",
            "sudo apt install -y postgresql-common",
            "echo '' | sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh",
            "sudo apt update",
            "sudo apt install -y postgresql-17 postgresql-contrib-17",
            "sudo systemctl stop postgresql || true",
            "sudo systemctl disable postgresql || true",
            "sudo rm -rf /var/lib/postgresql/17/main || true",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 2,
      name: "Install etcd",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo apt update",
            "sudo apt-get install -y wget curl",
            "rm -rf etcd etcd-v3.6.10-linux-amd64.tar.gz",
            "wget https://github.com/etcd-io/etcd/releases/download/v3.6.10/etcd-v3.6.10-linux-amd64.tar.gz",
            "tar xzf etcd-v3.6.10-linux-amd64.tar.gz",
            "mv etcd-v3.6.10-linux-amd64 etcd",
            "sudo mv etcd/etcd* /usr/local/bin/",
            "rm -rf etcd etcd-v3.6.10-linux-amd64.tar.gz",
            `sudo useradd --system --home /var/lib/etcd --shell /bin/false etcd || true`,
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 3,
      name: "Setup etcd directories",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo mkdir -p /etc/etcd",
            "sudo mkdir -p /etc/etcd/ssl",
            "sudo rm -rf /var/lib/etcd/*",
            "sudo mkdir -p /var/lib/etcd",
            "sudo chown -R etcd:etcd /var/lib/etcd",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 4,
      name: "Upload etcd SSL certificates",
      targetRole: "all_pg",
      commands: [],
      files: [], // Certs uploaded by orchestrator directly via SFTP
    },
    {
      phase: "postgres",
      stepNumber: 5,
      name: "Configure etcd (Node 1)",
      targetRole: "postgresql_1",
      commands: [
        {
          commands: [
            "sudo chown -R etcd:etcd /etc/etcd/",
            "sudo chmod 600 /etc/etcd/ssl/etcd-node*.key",
            "sudo chmod 644 /etc/etcd/ssl/etcd-node*.crt /etc/etcd/ssl/ca.crt",
          ],
        },
      ],
      files: [
        {
          path: "/etc/etcd/etcd.env",
          content: etcdEnvContent("postgresql-01", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 1),
          owner: "etcd:etcd",
          permissions: "644",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 6,
      name: "Configure etcd (Node 2)",
      targetRole: "postgresql_2",
      commands: [
        {
          commands: [
            "sudo chown -R etcd:etcd /etc/etcd/",
            "sudo chmod 600 /etc/etcd/ssl/etcd-node*.key",
            "sudo chmod 644 /etc/etcd/ssl/etcd-node*.crt /etc/etcd/ssl/ca.crt",
          ],
        },
      ],
      files: [
        {
          path: "/etc/etcd/etcd.env",
          content: etcdEnvContent("postgresql-02", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 2),
          owner: "etcd:etcd",
          permissions: "644",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 7,
      name: "Configure etcd (Node 3)",
      targetRole: "postgresql_3",
      commands: [
        {
          commands: [
            "sudo chown -R etcd:etcd /etc/etcd/",
            "sudo chmod 600 /etc/etcd/ssl/etcd-node*.key",
            "sudo chmod 644 /etc/etcd/ssl/etcd-node*.crt /etc/etcd/ssl/ca.crt",
          ],
        },
      ],
      files: [
        {
          path: "/etc/etcd/etcd.env",
          content: etcdEnvContent("postgresql-03", "${PRIVATE_IP_NODE_3}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 3),
          owner: "etcd:etcd",
          permissions: "644",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 8,
      name: "Create etcd systemd service",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo mkdir -p /var/lib/etcd",
            "sudo chown -R etcd:etcd /var/lib/etcd",
            "sudo systemctl daemon-reload",
            "sudo systemctl enable etcd",
            "sudo systemctl start etcd || true",
            "sleep 10",
            "sudo systemctl restart etcd || true",
            "sleep 10",
            "sudo systemctl restart etcd || true",
            "sleep 10",
            "echo '--- etcd service status ---'",
            "sudo systemctl status etcd --no-pager || true",
            "echo '--- etcd journal (last 30 lines) ---'",
            "sudo journalctl -u etcd --no-pager -n 30 || true",
            "sudo usermod -aG etcd $USER || true",
          ],
        },
      ],
      files: [
        {
          path: "/etc/systemd/system/etcd.service",
          content: ETCD_SERVICE,
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 9,
      name: "Setup PostgreSQL SSL directories",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo mkdir -p /var/lib/postgresql/data",
            "sudo chmod 700 /var/lib/postgresql/data",
            "sudo chown postgres:postgres /var/lib/postgresql/data",
            "sudo mkdir -p /var/lib/postgresql/ssl",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 10,
      name: "Upload PostgreSQL SSL certificates",
      targetRole: "all_pg",
      commands: [],
      files: [], // Uploaded by orchestrator via SFTP
    },
    {
      phase: "postgres",
      stepNumber: 11,
      name: "Set PostgreSQL SSL permissions",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo chmod 600 /var/lib/postgresql/ssl/server.key",
            "sudo chmod 644 /var/lib/postgresql/ssl/server.crt",
            "sudo chmod 600 /var/lib/postgresql/ssl/server.req",
            "sudo chown postgres:postgres /var/lib/postgresql/data",
            "sudo chown postgres:postgres /var/lib/postgresql/ssl/server.*",
            "sudo apt update",
            "sudo apt install -y acl",
            "sudo setfacl -m u:postgres:r /etc/etcd/ssl/ca.crt",
            "sudo setfacl -m u:postgres:r /etc/etcd/ssl/etcd-node*.crt",
            "sudo setfacl -m u:postgres:r /etc/etcd/ssl/etcd-node*.key",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 12,
      name: "Install Patroni",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo apt install -y patroni",
            "sudo mkdir -p /etc/patroni/",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 13,
      name: "Configure Patroni (Node 1)",
      targetRole: "postgresql_1",
      commands: [],
      files: [
        {
          path: "/etc/patroni/config.yml",
          content: patroniConfigContent("postgresql-01", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 1),
          owner: "postgres:postgres",
          permissions: "644",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 14,
      name: "Configure Patroni (Node 2)",
      targetRole: "postgresql_2",
      commands: [],
      files: [
        {
          path: "/etc/patroni/config.yml",
          content: patroniConfigContent("postgresql-02", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 2),
          owner: "postgres:postgres",
          permissions: "644",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 15,
      name: "Configure Patroni (Node 3)",
      targetRole: "postgresql_3",
      commands: [],
      files: [
        {
          path: "/etc/patroni/config.yml",
          content: patroniConfigContent("postgresql-03", "${PRIVATE_IP_NODE_3}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 3),
          owner: "postgres:postgres",
          permissions: "644",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 16,
      name: "Create server.pem on all nodes",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo sh -c 'cat /var/lib/postgresql/ssl/server.crt /var/lib/postgresql/ssl/server.key > /var/lib/postgresql/ssl/server.pem'",
            "sudo chown postgres:postgres /var/lib/postgresql/ssl/server.pem",
            "sudo chmod 600 /var/lib/postgresql/ssl/server.pem",
            "sudo openssl x509 -in /var/lib/postgresql/ssl/server.pem -text -noout | head -10",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 17,
      name: "Start Patroni on all nodes (leader election via etcd)",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo systemctl stop patroni || true",
            "sudo rm -rf /var/lib/postgresql/data",
            "sudo mkdir -p /var/lib/postgresql/data",
            "sudo chmod 700 /var/lib/postgresql/data",
            "sudo chown postgres:postgres /var/lib/postgresql/data",
            "sudo systemctl start patroni",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 18,
      name: "Wait for cluster formation and verify",
      targetRole: "postgresql_1",
      commands: [
        {
          commands: [
            "echo 'Waiting 30s for Patroni cluster to form...'",
            "sleep 30",
            "echo '--- Cluster state ---'",
            "patronictl -c /etc/patroni/config.yml list || true",
            "echo '--- Patroni journal ---'",
            "sudo journalctl -u patroni --no-pager -n 20 || true",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 19,
      name: "Update etcd state to existing",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo sed -i 's/ETCD_INITIAL_CLUSTER_STATE=\"new\"/ETCD_INITIAL_CLUSTER_STATE=\"existing\"/' /etc/etcd/etcd.env",
          ],
        },
      ],
      files: [],
    },

    // ==================== PHASE 2: HAProxy + Keepalived ====================
    {
      phase: "haproxy",
      stepNumber: 20,
      name: "Install HAProxy and keepalived",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo apt update",
            "sudo apt -y install haproxy keepalived curl",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 21,
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

defaults
    log global
    mode tcp
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
      stepNumber: 22,
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
      stepNumber: 23,
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
          content: failoverScriptContent("${SERVER_ID_1}"),
          permissions: "700",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 24,
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
          content: failoverScriptContent("${SERVER_ID_2}"),
          permissions: "700",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 25,
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
          content: failoverScriptContent("${SERVER_ID_3}"),
          permissions: "700",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 26,
      name: "Assign Floating IP to HAProxy 1 via Hetzner API",
      targetRole: "haproxy_1",
      commands: [
        {
          commands: [
            "echo 'Assigning Floating IP via Hetzner API to HAProxy 1...'",
            "curl -s -X POST -H \"Authorization: Bearer ${HETZNER_API_TOKEN}\" -H \"Content-Type: application/json\" -d '{\"server\": ${SERVER_ID_1}}' \"https://api.hetzner.cloud/v1/floating_ips/${FLOATING_IP_ID}/actions/assign\" | python3 -c \"import sys,json; print(json.load(sys.stdin))\" || true",
            "sleep 5",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 27,
      name: "Configure floating IP via netplan on all HAProxy nodes",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "echo 'Applying netplan to bind Floating IP...'",
            "sudo netplan apply || true",
            "echo '--- Network interfaces ---'",
            "ip addr show eth0 | grep inet || true",
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
      stepNumber: 28,
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
      stepNumber: 29,
      name: "Verify HAProxy + keepalived + floating IP",
      targetRole: "haproxy_1",
      commands: [
        {
          commands: [
            "echo '=== HAProxy ==='",
            "sudo systemctl status haproxy | head -5",
            "echo '=== Keepalived ==='",
            "sudo systemctl status keepalived | head -5",
            "echo '=== Floating IP on interface ==='",
            "ip addr show eth0 | grep ${FLOATING_IP} || echo 'Floating IP NOT found on interface!'",
            "echo '=== HAProxy backend check ==='",
            "echo 'show stat' | sudo socat stdio /run/haproxy/admin.sock 2>/dev/null || echo 'Stats socket not available'",
          ],
        },
      ],
      files: [],
    },
  ];
}
