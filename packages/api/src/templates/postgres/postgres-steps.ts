import type { StepDefinition } from "../types";
import { etcdEnvContent, ETCD_SERVICE } from "./etcd-config";
import { patroniConfigContent } from "./patroni-config";

export function getPostgresSteps(): StepDefinition[] {
  return [
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
      stepNumber: 5,
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
      stepNumber: 6,
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
      stepNumber: 7,
      name: "Create etcd systemd service and start",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo mkdir -p /var/lib/etcd",
            "sudo chown -R etcd:etcd /var/lib/etcd",
            "sudo systemctl daemon-reload",
            "sudo systemctl enable etcd",
            "sudo systemctl restart etcd || true",
            "echo 'Waiting for etcd to become active...'",
            "for i in $(seq 1 15); do",
            "  sleep 5",
            "  if sudo systemctl is-active --quiet etcd; then",
            "    echo \"etcd active after attempt $i\"",
            "    break",
            "  fi",
            "  echo \"Retry $i/15...\"",
            "  sudo systemctl restart etcd || true",
            "done",
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
      stepNumber: 8,
      name: "Verify etcd cluster health",
      targetRole: "postgresql_1",
      commands: [
        {
          commands: [
            "sudo etcdctl --endpoints=https://${PRIVATE_IP_NODE_1}:2379,https://${PRIVATE_IP_NODE_2}:2379,https://${PRIVATE_IP_NODE_3}:2379 --cacert=/etc/etcd/ssl/ca.crt --cert=/etc/etcd/ssl/etcd-node1.crt --key=/etc/etcd/ssl/etcd-node1.key endpoint health",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 9,
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
    {
      phase: "postgres",
      stepNumber: 10,
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
      stepNumber: 11,
      name: "Set PostgreSQL SSL permissions",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo chmod 600 /var/lib/postgresql/ssl/server.key",
            "sudo chmod 644 /var/lib/postgresql/ssl/server.crt",
            "sudo chown postgres:postgres /var/lib/postgresql/data",
            "sudo chown postgres:postgres /var/lib/postgresql/ssl/server.*",
            "sudo apt update",
            "sudo apt install -y acl",
            "sudo setfacl -m u:postgres:r /etc/etcd/ssl/ca.crt",
            "sudo setfacl -m u:postgres:r /etc/etcd/ssl/etcd-node*.crt",
            "sudo setfacl -m u:postgres:r /etc/etcd/ssl/etcd-node*.key",
            "sudo setfacl -m u:${ADMIN_USERNAME}:r /etc/etcd/ssl/ca.crt",
            "sudo setfacl -m u:${ADMIN_USERNAME}:r /etc/etcd/ssl/etcd-node*.crt",
            "sudo setfacl -m u:${ADMIN_USERNAME}:r /etc/etcd/ssl/etcd-node*.key",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 12,
      name: "Detect server resources and calculate PostgreSQL tuning",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')",
            "TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))",
            "SHARED_BUFFERS=$((TOTAL_RAM_MB / 4))",
            "MAX_CONNECTIONS=$((TOTAL_RAM_MB / 10))",
            "if [ \"$MAX_CONNECTIONS\" -lt 100 ]; then MAX_CONNECTIONS=100; fi",
            "if [ \"$MAX_CONNECTIONS\" -gt 500 ]; then MAX_CONNECTIONS=500; fi",
            "WORK_MEM=$(( (TOTAL_RAM_MB - SHARED_BUFFERS) / (MAX_CONNECTIONS * 3) ))",
            "if [ \"$WORK_MEM\" -lt 4 ]; then WORK_MEM=4; fi",
            "EFFECTIVE_CACHE_SIZE=$((TOTAL_RAM_MB * 3 / 4))",
            "MAINTENANCE_WORK_MEM=$((TOTAL_RAM_MB / 16))",
            "if [ \"$MAINTENANCE_WORK_MEM\" -lt 64 ]; then MAINTENANCE_WORK_MEM=64; fi",
            "if [ \"$MAINTENANCE_WORK_MEM\" -gt 1024 ]; then MAINTENANCE_WORK_MEM=1024; fi",
            "echo \"Detected RAM: ${TOTAL_RAM_MB}MB\"",
            "echo \"SHARED_BUFFERS=${SHARED_BUFFERS}MB\"",
            "echo \"MAX_CONNECTIONS=${MAX_CONNECTIONS}\"",
            "echo \"WORK_MEM=${WORK_MEM}MB\"",
            "echo \"EFFECTIVE_CACHE_SIZE=${EFFECTIVE_CACHE_SIZE}MB\"",
            "echo \"MAINTENANCE_WORK_MEM=${MAINTENANCE_WORK_MEM}MB\"",
            "echo \"${SHARED_BUFFERS}MB\" | sudo tee /tmp/pg_shared_buffers",
            "echo \"${MAX_CONNECTIONS}\" | sudo tee /tmp/pg_max_connections",
            "echo \"${WORK_MEM}MB\" | sudo tee /tmp/pg_work_mem",
            "echo \"${EFFECTIVE_CACHE_SIZE}MB\" | sudo tee /tmp/pg_effective_cache_size",
            "echo \"${MAINTENANCE_WORK_MEM}MB\" | sudo tee /tmp/pg_maintenance_work_mem",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 13,
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
      stepNumber: 14,
      name: "Configure Patroni (Node 1)",
      targetRole: "postgresql_1",
      commands: [],
      files: [
        {
          path: "/etc/patroni/config.yml",
          content: patroniConfigContent("postgresql-01", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 1),
          owner: "postgres:postgres",
          permissions: "640",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 15,
      name: "Configure Patroni (Node 2)",
      targetRole: "postgresql_2",
      commands: [],
      files: [
        {
          path: "/etc/patroni/config.yml",
          content: patroniConfigContent("postgresql-02", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 2),
          owner: "postgres:postgres",
          permissions: "640",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 16,
      name: "Configure Patroni (Node 3)",
      targetRole: "postgresql_3",
      commands: [],
      files: [
        {
          path: "/etc/patroni/config.yml",
          content: patroniConfigContent("postgresql-03", "${PRIVATE_IP_NODE_3}", "${PRIVATE_IP_NODE_1}", "${PRIVATE_IP_NODE_2}", "${PRIVATE_IP_NODE_3}", 3),
          owner: "postgres:postgres",
          permissions: "640",
        },
      ],
    },
    {
      phase: "postgres",
      stepNumber: 17,
      name: "Apply auto-tuned PostgreSQL parameters",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "if [ ! -f /tmp/pg_shared_buffers ]; then",
            "  echo 'ERROR: Tuning values not found (step 12 may have failed)'",
            "  exit 1",
            "fi",
            "SHARED_BUFFERS=$(cat /tmp/pg_shared_buffers)",
            "MAX_CONNECTIONS=$(cat /tmp/pg_max_connections)",
            "WORK_MEM=$(cat /tmp/pg_work_mem)",
            "EFFECTIVE_CACHE_SIZE=$(cat /tmp/pg_effective_cache_size)",
            "MAINTENANCE_WORK_MEM=$(cat /tmp/pg_maintenance_work_mem)",
            "sudo sed -i \"s/__SHARED_BUFFERS__/${SHARED_BUFFERS}/\" /etc/patroni/config.yml",
            "sudo sed -i \"s/__MAX_CONNECTIONS__/${MAX_CONNECTIONS}/\" /etc/patroni/config.yml",
            "sudo sed -i \"s/__WORK_MEM__/${WORK_MEM}/\" /etc/patroni/config.yml",
            "sudo sed -i \"s/__EFFECTIVE_CACHE_SIZE__/${EFFECTIVE_CACHE_SIZE}/\" /etc/patroni/config.yml",
            "sudo sed -i \"s/__MAINTENANCE_WORK_MEM__/${MAINTENANCE_WORK_MEM}/\" /etc/patroni/config.yml",
            "sudo chown postgres:postgres /etc/patroni/config.yml",
            "echo '--- Patroni config (tuning section) ---'",
            "sudo grep -A5 'shared_buffers' /etc/patroni/config.yml",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 18,
      name: "Start Patroni on all nodes (leader election via etcd)",
      targetRole: "all_pg",
      commands: [
        {
          commands: [
            "sudo systemctl stop patroni || true",
            "if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then",
            "  sudo rm -rf /var/lib/postgresql/data",
            "  sudo mkdir -p /var/lib/postgresql/data",
            "  sudo chmod 700 /var/lib/postgresql/data",
            "  sudo chown postgres:postgres /var/lib/postgresql/data",
            "fi",
            "sudo systemctl enable patroni",
            "sudo systemctl start patroni",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 19,
      name: "Wait for cluster formation and verify",
      targetRole: "postgresql_1",
      commands: [
        {
          commands: [
            "echo 'Waiting 30s for Patroni cluster to form...'",
            "sleep 30",
            "echo '--- Cluster state ---'",
            "sudo patronictl -c /etc/patroni/config.yml list",
            "LEADER_COUNT=$(sudo patronictl -c /etc/patroni/config.yml list 2>/dev/null | grep -c 'Leader' || echo '0')",
            "if [ \"$LEADER_COUNT\" -eq 0 ]; then",
            "  echo 'ERROR: No leader elected after 30 seconds'",
            "  echo '--- Patroni journal ---'",
            "  sudo journalctl -u patroni --no-pager -n 50",
            "  exit 1",
            "fi",
            "echo 'Leader elected successfully'",
            "echo '--- Patroni journal ---'",
            "sudo journalctl -u patroni --no-pager -n 20 || true",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "postgres",
      stepNumber: 20,
      name: "Enable pg_stat_statements extension",
      targetRole: "postgresql_1",
      commands: [
        {
          commands: [
            "echo \"${PRIVATE_IP_NODE_1}:5432:*:${SUPERUSER_USERNAME}:${SUPERUSER_PASSWORD}\" > /tmp/.pgpass && chmod 600 /tmp/.pgpass",
            "echo \"${PRIVATE_IP_NODE_2}:5432:*:${SUPERUSER_USERNAME}:${SUPERUSER_PASSWORD}\" >> /tmp/.pgpass",
            "echo \"${PRIVATE_IP_NODE_3}:5432:*:${SUPERUSER_USERNAME}:${SUPERUSER_PASSWORD}\" >> /tmp/.pgpass",
            "PGPASSFILE=/tmp/.pgpass psql -h ${PRIVATE_IP_NODE_1} -U ${SUPERUSER_USERNAME} -d postgres -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;' 2>/dev/null || PGPASSFILE=/tmp/.pgpass psql -h ${PRIVATE_IP_NODE_2} -U ${SUPERUSER_USERNAME} -d postgres -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;' 2>/dev/null || PGPASSFILE=/tmp/.pgpass psql -h ${PRIVATE_IP_NODE_3} -U ${SUPERUSER_USERNAME} -d postgres -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;'",
            "rm -f /tmp/.pgpass",
          ],
        },
      ],
      files: [],
    },
  ];
}
