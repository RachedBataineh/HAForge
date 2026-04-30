#!/bin/bash
# ============================================================================
# HAForge Cluster Post-Deployment Validation
# ============================================================================
# Usage: Paste this entire script into the terminal of each server.
#        It auto-detects whether it's a PG node or HA node and runs the
#        appropriate checks.
#
# Exit code: 0 = all checks passed, 1 = one or more failures
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

TOTAL=0
PASSED=0
FAILED=0

pass() {
  ((TOTAL++)) && ((PASSED++))
  echo -e "  ${GREEN}✓ PASS${NC}  $1"
}

fail() {
  ((TOTAL++)) && ((FAILED++))
  echo -e "  ${RED}✗ FAIL${NC}  $1 ${RED}${2:-}${NC}"
}

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

# --- Detect node type ---
IS_PG=false
IS_HA=false

if systemctl list-unit-files patroni.service >/dev/null 2>&1 || test -f /etc/patroni/config.yml; then
  IS_PG=true
  NODE_TYPE="PostgreSQL"
elif systemctl list-unit-files haproxy.service >/dev/null 2>&1 || test -f /etc/haproxy/haproxy.cfg; then
  IS_HA=true
  NODE_TYPE="HAProxy"
else
  echo -e "${RED}Cannot detect node type. Is this a HAForge cluster node?${NC}"
  exit 1
fi

HOSTNAME=$(hostname -s)

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          HAForge Cluster Post-Deployment Validation         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo -e "  Node:       ${BOLD}${HOSTNAME}${NC}"
echo -e "  Type:       ${BOLD}${NODE_TYPE}${NC}"
echo ""

# ============================================================================
# HARDENING (all nodes)
# ============================================================================
echo -e "${BOLD}── Hardening ──${NC}"

check "Admin user has passwordless sudo" sudo -n true

ROOT_LOCKED=$(sudo passwd -S root 2>/dev/null | awk '{print $2}')
if [[ "$ROOT_LOCKED" == "L" ]]; then pass "Root account is locked"; else fail "Root account is locked" "(status: ${ROOT_LOCKED})"; fi

check "SSH hardening applied (PermitRootLogin no)" test -f /etc/ssh/sshd_config.d/99-hardening.conf
if test -f /etc/ssh/sshd_config.d/99-hardening.conf; then
  check "SSH: PermitRootLogin no" grep -q "PermitRootLogin no" /etc/ssh/sshd_config.d/99-hardening.conf
  check "SSH: PasswordAuthentication no" grep -q "PasswordAuthentication no" /etc/ssh/sshd_config.d/99-hardening.conf
fi

check "Kernel/network hardening active" test -f /etc/sysctl.d/99-hardening.conf
check "CrowdSec service active" sudo systemctl is-active crowdsec
check "CrowdSec firewall bouncer active" sudo systemctl is-active crowdsec-firewall-bouncer
check "Automatic security updates configured" test -f /etc/apt/apt.conf.d/20auto-upgrades

echo ""

# ============================================================================
# POSTGRESQL NODE
# ============================================================================
if $IS_PG; then
  echo -e "${BOLD}── PostgreSQL ──${NC}"

  check "PostgreSQL 18 package installed" dpkg -l postgresql-18

  check "etcd binary installed" test -x /usr/local/bin/etcd

  ETCD_VER=$(etcd --version 2>/dev/null | head -1 || echo "unknown")
  pass "etcd version: ${ETCD_VER}"

  check "etcd service active" sudo systemctl is-active etcd

  check "etcd SSL certificates present" test -f /etc/etcd/ssl/ca.crt
  check "etcd SSL certificates not expired" sudo openssl x509 -checkend 86400 -in /etc/etcd/ssl/ca.crt

  ETCD_HEALTH=$(sudo etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/etcd/ssl/ca.crt --cert=/etc/etcd/ssl/etcd-node1.crt --key=/etc/etcd/ssl/etcd-node1.key endpoint health 2>&1 || echo "unhealthy")
  if echo "$ETCD_HEALTH" | grep -q "healthy"; then pass "etcd endpoint healthy"; else fail "etcd endpoint healthy" "(${ETCD_HEALTH})"; fi

  check "Patroni service active" sudo systemctl is-active patroni

  check "Patroni config exists" sudo test -f /etc/patroni/config.yml
  check "Patroni configured for PostgreSQL 18" sudo grep -q "/usr/lib/postgresql/18/bin" /etc/patroni/config.yml

  if sudo test -f /etc/patroni/config.yml; then
    if sudo grep -qE "__SHARED_BUFFERS__|__MAX_CONNECTIONS__|__WORK_MEM__|__EFFECTIVE_CACHE_SIZE__|__MAINTENANCE_WORK_MEM__" /etc/patroni/config.yml; then
      fail "Patroni tuning resolved (no placeholders)" "(placeholders found in config)"
    else
      pass "Patroni tuning resolved (no placeholders)"
    fi
  fi

  check "PostgreSQL data dir exists (700, postgres)" test -d /var/lib/postgresql/data && test "$(stat -c '%a' /var/lib/postgresql/data)" = "700" && test "$(stat -c '%U' /var/lib/postgresql/data)" = "postgres"

  check "PostgreSQL SSL certs present" test -f /var/lib/postgresql/ssl/server.crt && test -f /var/lib/postgresql/ssl/server.key
  check "PostgreSQL SSL cert not expired" sudo openssl x509 -checkend 86400 -in /var/lib/postgresql/ssl/server.crt

  PG_EXT=$(sudo -u postgres psql -tAc "SELECT count(*) FROM pg_extension WHERE extname='pg_stat_statements';" 2>/dev/null || echo "0")
  if [[ "$PG_EXT" == "1" ]]; then pass "pg_stat_statements extension installed"; else fail "pg_stat_statements extension installed" "(not found)"; fi

  echo ""
fi

# ============================================================================
# HAPROXY NODE
# ============================================================================
if $IS_HA; then
  echo -e "${BOLD}── HAProxy ──${NC}"

  check "HAProxy service active" sudo systemctl is-active haproxy
  check "HAProxy config valid" sudo haproxy -c -f /etc/haproxy/haproxy.cfg

  check "HAProxy stats socket accessible" test -S /run/haproxy/admin.sock
  HA_BACKEND_UP=$(echo "show stat" | sudo socat stdio /run/haproxy/admin.sock 2>/dev/null | grep postgresql | awk -F',' '{print $2}' | grep -c "^UP$" || echo "0")
  HA_BACKEND_TOTAL=$(echo "show stat" | sudo socat stdio /run/haproxy/admin.sock 2>/dev/null | grep postgresql | wc -l || echo "0")
  if [[ "$HA_BACKEND_UP" -ge 1 ]]; then pass "PostgreSQL backends UP (${HA_BACKEND_UP}/${HA_BACKEND_TOTAL})"; else fail "PostgreSQL backends UP" "(${HA_BACKEND_UP}/${HA_BACKEND_TOTAL})"; fi

  check "CA certificate present" test -f /etc/haproxy/ca.crt

  check "Keepalived service active" sudo systemctl is-active keepalived
  check "Health check script present and executable" test -x /etc/keepalived/check_haproxy.sh
  check "Failover script present" test -x /etc/keepalived/failover.sh
  check "Failover env config present" test -f /etc/keepalived/.env

  KEEPALIVED_STATE=$(sudo journalctl -u keepalived --no-pager -n 100 2>/dev/null | grep -i "entering" | tail -1 || echo "")
  if echo "$KEEPALIVED_STATE" | grep -qi "MASTER"; then
    pass "Keepalived state: MASTER"
  elif echo "$KEEPALIVED_STATE" | grep -qi "BACKUP"; then
    pass "Keepalived state: BACKUP"
  else
    fail "Keepalived state detected" "(could not determine)"
  fi

  FLOATING_IP=$(grep -oP 'addresses:\s*-\s*\K[^/]+' /etc/netplan/60-floating-ip.yaml 2>/dev/null || echo "")
  if [[ -n "$FLOATING_IP" ]]; then
    check "Floating IP ${FLOATING_IP} bound on interface" ip addr show enp7s0 | grep -q "$FLOATING_IP"
    check "Floating IP ${FLOATING_IP} reachable (ping)" ping -c 1 -W 3 "$FLOATING_IP"
  else
    fail "Floating IP detected from netplan" "(not found in /etc/netplan/60-floating-ip.yaml)"
  fi

  check "Netplan floating IP config present" test -f /etc/netplan/60-floating-ip.yaml
  check "CrowdSec HAProxy bouncer active" sudo systemctl is-active crowdsec-spoa-bouncer

  echo ""
fi

# ============================================================================
# MONITORING (all nodes)
# ============================================================================
echo -e "${BOLD}── Monitoring ──${NC}"

check "Node Exporter service active" sudo systemctl is-active node_exporter
check "Node Exporter metrics endpoint :9100" curl -sf http://localhost:9100/metrics

if $IS_PG; then
  check "PostgreSQL Exporter service active" sudo systemctl is-active postgres_exporter
  check "PostgreSQL Exporter metrics endpoint :9187" curl -sf http://localhost:9187/metrics

  PG_MON=$(sudo -u postgres psql -tAc "SELECT count(*) FROM pg_roles WHERE rolname='postgres_exporter' AND pg_has_role('postgres_exporter', 'pg_monitor', 'MEMBER');" 2>/dev/null || echo "0")
  if [[ "$PG_MON" == "1" ]]; then pass "postgres_exporter user has pg_monitor role"; else fail "postgres_exporter user has pg_monitor role" "(not granted)"; fi
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================
echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ALL CHECKS PASSED  ${TOTAL}/${TOTAL}${NC}"
else
  echo -e "${RED}${BOLD}  ${FAILED} CHECK(S) FAILED  ${PASSED}/${TOTAL} passed${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo ""

[[ "$FAILED" -gt 0 ]] && exit 1
exit 0
