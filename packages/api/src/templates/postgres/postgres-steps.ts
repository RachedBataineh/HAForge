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
      files: [],
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
  ];
}
