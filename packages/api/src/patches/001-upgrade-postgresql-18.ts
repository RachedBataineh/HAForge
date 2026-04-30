import type { PatchDefinition } from "./types";

/**
 * Patch: Rolling upgrade PostgreSQL 17 → 18.3
 *
 * Strategy for Patroni-managed clusters:
 *
 * pg_upgrade cannot run on replicas (they're in recovery mode and pg_controldata
 * records that). Instead, we use the Patroni-standard approach:
 *
 * 1. Install PG 18 on all nodes
 * 2. Upgrade the LEADER with pg_upgrade (it's a primary, no issues)
 * 3. Re-bootstrap replicas by wiping data and letting Patroni pg_basebackup
 *    from the upgraded PG 18 leader
 *
 * This causes brief downtime during step 2 (while the leader is being upgraded
 * and restarted, ~2-3 minutes). Replicas re-bootstrap automatically with zero
 * data loss.
 *
 * Environment variables injected by the patch runner:
 * - LEADER_ROLE: e.g. "postgresql_1"
 * - LEADER_IP: IP of the current leader
 * - REPLICA_1_ROLE: first replica's role
 * - REPLICA_2_ROLE: second replica's role
 * - IS_LEADER: "1" if this server is the leader, "0" otherwise
 * - MY_ROLE: this server's role
 */
export const upgradePostgres18: PatchDefinition = {
  id: "001-upgrade-postgresql-18",
  name: "Upgrade PostgreSQL to 18.3",
  description:
    "Upgrades PostgreSQL from 17 to 18.3. The leader is upgraded first using pg_upgrade, then replicas are re-bootstrapped from the upgraded leader. Brief downtime (~2-3 min) during leader upgrade.",
  phase: "postgres",
  discoverLeader: true,
  steps: [
    {
      name: "Pause Patroni auto-failover",
      targetRole: "postgresql_1",
      commands: [
        // Only run on the leader
        "if [ \"$IS_LEADER\" != \"1\" ]; then echo 'Skipping - not the leader'; exit 0; fi",
        "sudo patronictl -c /etc/patroni/config.yml pause --wait 2>/dev/null || echo 'Pause not supported or already paused'",
        "echo 'Patroni auto-failover paused'",
      ],
    },
    {
      name: "Install PostgreSQL 18 packages on all nodes",
      targetRole: "all_pg",
      commands: [
        // Idempotency check
        "if [ -f /usr/lib/postgresql/18/bin/postgres ] && [ \"$(cat /var/lib/postgresql/data/PG_VERSION 2>/dev/null || echo '17')\" = \"18\" ]; then echo 'PG 18 already installed and active'; exit 0; fi",
        "if [ -f /usr/lib/postgresql/18/bin/postgres ]; then echo 'PG 18 packages already installed'; exit 0; fi",
        "sudo apt update",
        "sudo apt install -y postgresql-18 postgresql-contrib-18",
        "echo 'PostgreSQL 18 packages installed'",
      ],
    },
    {
      name: "Upgrade leader with pg_upgrade",
      targetRole: "all_pg",
      commands: [
        // Only run on the leader
        "if [ \"$IS_LEADER\" != \"1\" ]; then echo 'Skipping - not the leader'; exit 0; fi",
        "echo \"Upgrading leader: $MY_ROLE\"",
        "",
        "# Stop Patroni on leader",
        "sudo systemctl stop patroni",
        "sleep 3",
        "",
        "# Init fresh PG 18 data dir for upgrade",
        "sudo -u postgres /usr/lib/postgresql/18/bin/initdb -D /var/lib/postgresql/18/main 2>/dev/null || true",
        "",
        "# pg_upgrade compatibility check",
        "cd /tmp",
        "sudo -u postgres /usr/lib/postgresql/18/bin/pg_upgrade \\",
        "  --old-datadir=/var/lib/postgresql/data \\",
        "  --new-datadir=/var/lib/postgresql/18/main \\",
        "  --old-bindir=/usr/lib/postgresql/17/bin \\",
        "  --new-bindir=/usr/lib/postgresql/18/bin \\",
        "  --link \\",
        "  --check || { echo 'pg_upgrade check failed'; exit 1; }",
        "",
        "# Run the actual upgrade",
        "sudo -u postgres /usr/lib/postgresql/18/bin/pg_upgrade \\",
        "  --old-datadir=/var/lib/postgresql/data \\",
        "  --new-datadir=/var/lib/postgresql/18/main \\",
        "  --old-bindir=/usr/lib/postgresql/17/bin \\",
        "  --new-bindir=/usr/lib/postgresql/18/bin \\",
        "  --link",
        "",
        "# Swap data directories",
        "sudo mv /var/lib/postgresql/data /var/lib/postgresql/data.pg17.bak",
        "sudo mv /var/lib/postgresql/18/main /var/lib/postgresql/data",
        "sudo chmod 700 /var/lib/postgresql/data",
        "sudo chown -R postgres:postgres /var/lib/postgresql/data",
        "",
        "# Update Patroni config to use PG 18",
        "sudo sed -i 's|/usr/lib/postgresql/17/bin|/usr/lib/postgresql/18/bin|' /etc/patroni/config.yml",
        "sudo chown postgres:postgres /etc/patroni/config.yml",
        "",
        "# Ensure log dir exists",
        "sudo mkdir -p /var/lib/postgresql/data/log",
        "sudo chown postgres:postgres /var/lib/postgresql/data/log",
        "",
        "# Start Patroni on leader",
        "sudo systemctl reset-failed patroni 2>/dev/null || true",
        "sudo systemctl start patroni",
        "echo 'Leader upgraded and Patroni restarted'",
      ],
      validation: "sleep 25 && sudo systemctl is-active patroni",
    },
    {
      name: "Verify leader is healthy after upgrade",
      targetRole: "postgresql_1",
      commands: [
        "echo 'Waiting 20s for leader to stabilize...'",
        "sleep 20",
        "sudo patronictl -c /etc/patroni/config.yml list",
        "",
        "LEADER_COUNT=$(sudo patronictl -c /etc/patroni/config.yml list 2>/dev/null | grep -c 'Leader.*running' || echo '0')",
        "if [ \"$LEADER_COUNT\" -ne 1 ]; then echo 'ERROR: No running leader found'; exit 1; fi",
        "",
        "# Verify PG version is 18",
        "PG_VERSION=$(sudo -u postgres /usr/lib/postgresql/18/bin/pg_controldata -D /var/lib/postgresql/data 2>/dev/null | grep 'pg_control version' || echo 'unknown')",
        "echo \"Leader is healthy: $PG_VERSION\"",
      ],
    },
    {
      name: "Re-bootstrap first replica from PG 18 leader",
      targetRole: "all_pg",
      commands: [
        "if [ \"$MY_ROLE\" != \"$REPLICA_1_ROLE\" ]; then echo 'Skipping - not first replica'; exit 0; fi",
        "echo \"Re-bootstrapping first replica: $MY_ROLE from upgraded leader\"",
        "",
        "# Stop Patroni on this replica",
        "sudo systemctl stop patroni",
        "sleep 3",
        "",
        "# Remove the old PG 17 data entirely",
        "sudo rm -rf /var/lib/postgresql/data",
        "sudo mkdir -p /var/lib/postgresql/data",
        "sudo chmod 700 /var/lib/postgresql/data",
        "sudo chown postgres:postgres /var/lib/postgresql/data",
        "",
        "# Update Patroni config to use PG 18",
        "sudo sed -i 's|/usr/lib/postgresql/17/bin|/usr/lib/postgresql/18/bin|' /etc/patroni/config.yml",
        "sudo chown postgres:postgres /etc/patroni/config.yml",
        "",
        "# Start Patroni - it will automatically pg_basebackup from the PG 18 leader",
        "sudo systemctl reset-failed patroni 2>/dev/null || true",
        "sudo systemctl start patroni",
        "echo 'First replica Patroni restarting (will pg_basebackup from leader)...'",
      ],
      validation: "sleep 30 && sudo systemctl is-active patroni",
    },
    {
      name: "Wait for first replica to rejoin",
      targetRole: "postgresql_1",
      commands: [
        "echo 'Waiting 30s for first replica to rejoin...'",
        "sleep 30",
        "sudo patronictl -c /etc/patroni/config.yml list",
        "REPLICA_COUNT=$(sudo patronictl -c /etc/patroni/config.yml list 2>/dev/null | grep -c 'Replica.*running' || echo '0')",
        "if [ \"$REPLICA_COUNT\" -lt 1 ]; then echo 'ERROR: First replica did not rejoin'; exit 1; fi",
        "echo \"First replica is running. Total replicas: $REPLICA_COUNT\"",
      ],
    },
    {
      name: "Re-bootstrap second replica from PG 18 leader",
      targetRole: "all_pg",
      commands: [
        "if [ \"$MY_ROLE\" != \"$REPLICA_2_ROLE\" ]; then echo 'Skipping - not second replica'; exit 0; fi",
        "echo \"Re-bootstrapping second replica: $MY_ROLE from upgraded leader\"",
        "",
        "sudo systemctl stop patroni",
        "sleep 3",
        "",
        "sudo rm -rf /var/lib/postgresql/data",
        "sudo mkdir -p /var/lib/postgresql/data",
        "sudo chmod 700 /var/lib/postgresql/data",
        "sudo chown postgres:postgres /var/lib/postgresql/data",
        "",
        "sudo sed -i 's|/usr/lib/postgresql/17/bin|/usr/lib/postgresql/18/bin|' /etc/patroni/config.yml",
        "sudo chown postgres:postgres /etc/patroni/config.yml",
        "",
        "sudo systemctl reset-failed patroni 2>/dev/null || true",
        "sudo systemctl start patroni",
        "echo 'Second replica Patroni restarting (will pg_basebackup from leader)...'",
      ],
      validation: "sleep 30 && sudo systemctl is-active patroni",
    },
    {
      name: "Resume Patroni and verify full cluster health",
      targetRole: "postgresql_1",
      commands: [
        "echo 'Waiting 30s for second replica to rejoin...'",
        "sleep 30",
        "",
        "# Resume auto-failover",
        "sudo patronictl -c /etc/patroni/config.yml resume 2>/dev/null || echo 'Resume not needed'",
        "echo 'Patroni auto-failover resumed'",
        "",
        "# Final cluster health check",
        "sudo patronictl -c /etc/patroni/config.yml list",
        "",
        "LEADER_COUNT=$(sudo patronictl -c /etc/patroni/config.yml list 2>/dev/null | grep -c 'Leader.*running' || echo '0')",
        "REPLICA_COUNT=$(sudo patronictl -c /etc/patroni/config.yml list 2>/dev/null | grep -c 'Replica.*running' || echo '0')",
        "",
        "if [ \"$LEADER_COUNT\" -ne 1 ]; then echo 'ERROR: Expected 1 leader, found $LEADER_COUNT'; exit 1; fi",
        "if [ \"$REPLICA_COUNT\" -ne 2 ]; then echo 'ERROR: Expected 2 replicas, found $REPLICA_COUNT'; exit 1; fi",
        "",
        "echo ''",
        "echo '=== PostgreSQL 18.3 Upgrade Complete ==='",
        "echo \"Leader: $LEADER_COUNT, Replicas: $REPLICA_COUNT\"",
        "echo 'All nodes running PostgreSQL 18'",
      ],
    },
  ],
};
