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
function etcdEnvContent(
  nodeName: string,
  selfIp: string,
  _ip1: string,
  _ip2: string,
  _ip3: string,
  nodeNum: number,
) {
  return `ETCD_NAME="${nodeName}"
ETCD_DATA_DIR="/var/lib/etcd"
ETCD_INITIAL_CLUSTER="postgresql-01=https://\${IP_ADDRESS_NODE_1}:2380,postgresql-02=https://\${IP_ADDRESS_NODE_2}:2380,postgresql-03=https://\${IP_ADDRESS_NODE_3}:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="etcd-cluster"
ETCD_INITIAL_ADVERTISE_PEER_URLS="https://${selfIp}:2380"
ETCD_LISTEN_PEER_URLS="https://0.0.0.0:2380"
ETCD_LISTEN_CLIENT_URLS="https://0.0.0.0:2379"
ETCD_ADVERTISE_CLIENT_URLS="https://${selfIp}:2379"
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
function patroniConfigContent(
  nodeName: string,
  selfIp: string,
  ip1: string,
  ip2: string,
  ip3: string,
  nodeNum: number,
) {
  return `scope: postgresql-cluster
namespace: /service/
name: ${nodeName}

etcd3:
  hosts: ${ip1}:2379,${ip2}:2379,${ip3}:2379
  protocol: https
  cacert: /etc/etcd/ssl/ca.crt
  cert: /etc/etcd/ssl/etcd-node${nodeNum}.crt
  key: /etc/etcd/ssl/etcd-node${nodeNum}.key

restapi:
  listen: 0.0.0.0:8008
  connect_address: ${selfIp}:8008
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
        - hostssl replication replicator ${ip1}/32 md5
        - hostssl replication replicator ${ip2}/32 md5
        - hostssl replication replicator ${ip3}/32 md5
        - hostssl all all 127.0.0.1/32 md5
        - hostssl all all 0.0.0.0/0 md5
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${selfIp}:5432
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

// --- HAProxy config template ---
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
    server postgresql-01 \${IP_ADDRESS_NODE_1_POSTGRESQL}:5432 port 8008 check check-ssl verify none
    server postgresql-02 \${IP_ADDRESS_NODE_2_POSTGRESQL}:5432 port 8008 check check-ssl verify none
    server postgresql-03 \${IP_ADDRESS_NODE_3_POSTGRESQL}:5432 port 8008 check check-ssl verify none`;
}

// --- Failover script template ---
function failoverScriptContent(myServerId: string, priorityServers: string) {
  return `#!/bin/bash

HETZNER_API_TOKEN="\${HETZNER_API_TOKEN}"
FLOATING_IP_ID="\${FLOATING_IP_ID}"
MY_SERVER_ID="${myServerId}"
PRIORITY_SERVERS="${priorityServers}"
CHECK_INTERVAL=5
HAPROXY_PORT=5432

LOG_FILE="/var/log/haproxy-failover.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_haproxy() {
    if ! pidof haproxy > /dev/null; then
        log "ERROR: HAProxy process not running"
        return 1
    fi
    if ! ss -ltn | grep -q ":$HAPROXY_PORT"; then
        log "ERROR: HAProxy not listening on port $HAPROXY_PORT"
        return 1
    fi
    BACKEND_STATUS=$(echo "show stat" | socat stdio /run/haproxy/admin.sock 2>/dev/null | grep postgres_backend | grep -v "^#" | head -1)
    if [ -z "$BACKEND_STATUS" ]; then
        log "WARNING: Could not get backend status"
        return 0
    fi
    BACKEND_UP=$(echo "$BACKEND_STATUS" | awk -F',' '{print $18}')
    if [[ "$BACKEND_UP" != *"UP"* ]]; then
        log "WARNING: No healthy backends found"
    fi
    return 0
}

get_current_floating_ip_server() {
    curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \\
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID" | \\
        jq -r '.floating_ip.server // "null"'
}

assign_floating_ip() {
    local TARGET_SERVER_ID=$1
    log "Attempting to assign Floating IP to server $TARGET_SERVER_ID"
    RESPONSE=$(curl -s -X POST \\
        -H "Authorization: Bearer $HETZNER_API_TOKEN" \\
        -H "Content-Type: application/json" \\
        -d "{\\"server\\": $TARGET_SERVER_ID}" \\
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID/actions/assign")
    if echo "$RESPONSE" | jq -e '.error' > /dev/null; then
        log "ERROR: Failed to assign Floating IP: $RESPONSE"
        return 1
    else
        log "SUCCESS: Floating IP assigned to server $TARGET_SERVER_ID"
        return 0
    fi
}

perform_failover() {
    log "Starting failover process..."
    for SERVER in $PRIORITY_SERVERS; do
        log "Checking if server $SERVER can take over..."
        if assign_floating_ip "$SERVER"; then
            log "Failover completed to server $SERVER"
            return 0
        fi
    done
    log "ERROR: Failover failed - no servers available"
    return 1
}

log "Starting Hetzner Floating IP failover monitoring on server $MY_SERVER_ID"

while true; do
    CURRENT_SERVER=$(get_current_floating_ip_server)
    if [ "$CURRENT_SERVER" != "null" ] && [ "$CURRENT_SERVER" == "$MY_SERVER_ID" ]; then
        if ! check_haproxy; then
            log "HAProxy health check failed on current owner"
            perform_failover
        fi
    fi
    sleep $CHECK_INTERVAL
done`;
}

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

// --- HAProxy failover systemd service ---
const HAPROXY_FAILOVER_SERVICE = `[Unit]
Description=HAProxy Hetzner Failover Monitor
After=network-online.target haproxy.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/etc/haproxy/hetzner-failover.sh
Restart=always
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target`;

export function getClusterSteps(): StepDefinition[] {
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
            "sudo apt install -y postgresql postgresql-contrib",
            "sudo systemctl stop postgresql",
            "sudo systemctl disable postgresql",
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
          content: etcdEnvContent("postgresql-01", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_3}", 1),
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
          content: etcdEnvContent("postgresql-02", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_3}", 2),
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
          content: etcdEnvContent("postgresql-03", "${IP_ADDRESS_NODE_3}", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_3}", 3),
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
            "sleep 5",
            "sudo systemctl restart etcd",
            "sleep 3",
            "sudo systemctl status etcd --no-pager || true",
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
          content: patroniConfigContent("postgresql-01", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_3}", 1),
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
          content: patroniConfigContent("postgresql-02", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_3}", 2),
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
          content: patroniConfigContent("postgresql-03", "${IP_ADDRESS_NODE_3}", "${IP_ADDRESS_NODE_1}", "${IP_ADDRESS_NODE_2}", "${IP_ADDRESS_NODE_3}", 3),
          owner: "postgres:postgres",
          permissions: "644",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 16,
      name: "Finalize Patroni setup",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo sh -c 'cat /var/lib/postgresql/ssl/server.crt /var/lib/postgresql/ssl/server.key > /var/lib/postgresql/ssl/server.pem'",
            "sudo chown postgres:postgres /var/lib/postgresql/ssl/server.pem",
            "sudo chmod 600 /var/lib/postgresql/ssl/server.pem",
            "sudo openssl x509 -in /var/lib/postgresql/ssl/server.pem -text -noout",
            "sudo systemctl restart patroni",
            "sleep 5",
            "sudo sed -i 's/ETCD_INITIAL_CLUSTER_STATE=\"new\"/ETCD_INITIAL_CLUSTER_STATE=\"existing\"/' /etc/etcd/etcd.env",
          ],
        },
      ],
      files: [],
      validation: "patronictl -c /etc/patroni/config.yml list || true",
    },

    // ==================== PHASE 2: HAProxy ====================
    {
      phase: "haproxy",
      stepNumber: 17,
      name: "Install HAProxy and tools",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo apt update",
            "sudo apt -y install haproxy",
            "sudo apt -y install curl jq socat",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 18,
      name: "Configure HAProxy",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo systemctl reload haproxy",
          ],
        },
      ],
      files: [
        {
          path: "/etc/haproxy/haproxy.cfg",
          content: `global
    stats socket /run/haproxy/admin.sock mode 600 level user
    log /dev/log local0
    log /dev/log local1 notice
    maxconn 2000

defaults
    log     global
    mode    tcp
    option  tcplog
    option  dontlognull
    timeout connect 5s
    timeout client  30s
    timeout server  30s

${haproxyConfigContent()}`,
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 19,
      name: "Create failover script (HAProxy 1)",
      targetRole: "haproxy_1",
      commands: [
        {
          commands: [
            "sudo chmod +x /etc/haproxy/hetzner-failover.sh",
            "sudo touch /var/log/haproxy-failover.log",
            "sudo chmod 644 /var/log/haproxy-failover.log",
          ],
        },
      ],
      files: [
        {
          path: "/etc/haproxy/hetzner-failover.sh",
          content: failoverScriptContent("${SERVER_ID_1}", "${SERVER_ID_2} ${SERVER_ID_3}"),
          permissions: "755",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 20,
      name: "Create failover script (HAProxy 2)",
      targetRole: "haproxy_2",
      commands: [
        {
          commands: [
            "sudo chmod +x /etc/haproxy/hetzner-failover.sh",
            "sudo touch /var/log/haproxy-failover.log",
            "sudo chmod 644 /var/log/haproxy-failover.log",
          ],
        },
      ],
      files: [
        {
          path: "/etc/haproxy/hetzner-failover.sh",
          content: failoverScriptContent("${SERVER_ID_2}", "${SERVER_ID_3} ${SERVER_ID_1}"),
          permissions: "755",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 21,
      name: "Create failover script (HAProxy 3)",
      targetRole: "haproxy_3",
      commands: [
        {
          commands: [
            "sudo chmod +x /etc/haproxy/hetzner-failover.sh",
            "sudo touch /var/log/haproxy-failover.log",
            "sudo chmod 644 /var/log/haproxy-failover.log",
          ],
        },
      ],
      files: [
        {
          path: "/etc/haproxy/hetzner-failover.sh",
          content: failoverScriptContent("${SERVER_ID_3}", "${SERVER_ID_1} ${SERVER_ID_2}"),
          permissions: "755",
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 22,
      name: "Create failover systemd service",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo systemctl daemon-reload",
            "sudo systemctl enable haproxy-failover",
            "sudo systemctl start haproxy-failover",
          ],
        },
      ],
      files: [
        {
          path: "/etc/systemd/system/haproxy-failover.service",
          content: HAPROXY_FAILOVER_SERVICE,
        },
      ],
    },
    {
      phase: "haproxy",
      stepNumber: 23,
      name: "Restart all services",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "sudo systemctl reload haproxy",
            "sudo systemctl restart haproxy-failover",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "haproxy",
      stepNumber: 24,
      name: "Verify HAProxy setup",
      targetRole: "haproxy_1",
      commands: [
        {
          commands: [
            "sudo systemctl status haproxy | head -5",
            "sudo systemctl status haproxy-failover | head -5",
            `echo "show stat" | socat stdio /run/haproxy/admin.sock || true`,
          ],
        },
      ],
      files: [],
    },
  ];
}
