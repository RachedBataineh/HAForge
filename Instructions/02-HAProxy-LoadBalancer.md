# HAProxy Load Balancer with Hetzner Cloud Failover

High-availability load balancing layer for the PostgreSQL cluster using HAProxy with automatic Floating IP failover via Hetzner Cloud API.

## Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │      Hetzner Floating IP            │
                    │       ${FLOATING_IP}                │
                    └─────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │           Hetzner API              │
                    │    (Automatic Failover Trigger)    │
                    └─────────────────┬─────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
        ┌─────▼─────┐           ┌────▼────┐           ┌─────▼─────┐
        │ HAProxy 1 │           │HAProxy 2│           │ HAProxy 3 │
        │  Primary  │           │ Backup  │           │  Backup   │
        │priority 1 │           │priority2│           │priority 3  │
        │Failover   │           │Failover │           │Failover   │
        │  Script   │           │ Script  │           │  Script   │
        └─────┬─────┘           └────┬────┘           └─────┬─────┘
              │                     │                       │
              └─────────────────────┼───────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐   ┌────▼────┐   ┌─────▼─────┐
              │PostgreSQL │   │PostgreSQL│   │PostgreSQL │
              │  Node 01  │   │ Node 02  │   │  Node 03  │
              └───────────┘   └──────────┘   └───────────┘
                    │               │               │
              Port 5432       Port 5432        Port 5432
              Port 8008       Port 8008        Port 8008
```

## Variables

| Variable | Description |
|----------|-------------|
| `${IP_ADDRESS_NODE_1_POSTGRESQL}` | IP address of first PostgreSQL node |
| `${IP_ADDRESS_NODE_2_POSTGRESQL}` | IP address of second PostgreSQL node |
| `${IP_ADDRESS_NODE_3_POSTGRESQL}` | IP address of third PostgreSQL node |
| `${FLOATING_IP}` | Hetzner Floating IP address for client connections |
| `${HETZNER_API_TOKEN}` | Hetzner API Token with read/write access |
| `${FLOATING_IP_ID}` | Hetzner Floating IP ID (numeric) |
| `${SERVER_ID_1}` | Hetzner Server ID for HAProxy 1 |
| `${SERVER_ID_2}` | Hetzner Server ID for HAProxy 2 |
| `${SERVER_ID_3}` | Hetzner Server ID for HAProxy 3 |

## Prerequisites

- **Cloud Provider:** Hetzner Cloud
- **Operating System:** Ubuntu/Debian Linux
- **Network:** All HAProxy nodes must communicate with PostgreSQL nodes on ports 5432 and 8008
- **PostgreSQL Cluster:** PostgreSQL cluster with Patroni must be running first
- **Hetzner Floating IP:** Already created and assigned to the first HAProxy server
- **Hetzner Network:** (Optional) Servers in a private network for internal communication
- **Tools:** curl and jq for API calls

---

## Step 1: Install HAProxy and Required Tools

Run these commands on **all three HAProxy servers**.

```bash
# Update package lists
sudo apt update

# Install HAProxy
sudo apt -y install haproxy

# Install required tools for API failover script
sudo apt -y install curl jq

# Install hetzner-cli for easier management (optional)
# wget https://github.com/hetznercloud/cli/releases/download/v1.38.0/hcloud-linux-amd64.tar.gz
# tar xvf hcloud-linux-amd64.tar.gz
# sudo mv hcloud /usr/local/bin/
```

---

## Step 2: Configure HAProxy

Edit `/etc/haproxy/haproxy.cfg` on **all three HAProxy servers**.

Replace or append the following configuration:

```haproxy
frontend postgres_frontend
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
    server postgresql-01 ${IP_ADDRESS_NODE_1_POSTGRESQL}:5432 port 8008 check check-ssl verify none
    server postgresql-02 ${IP_ADDRESS_NODE_2_POSTGRESQL}:5432 port 8008 check check-ssl verify none
    server postgresql-03 ${IP_ADDRESS_NODE_3_POSTGRESQL}:5432 port 8008 check check-ssl verify none
```

After editing, reload HAProxy:

```bash
sudo systemctl reload haproxy
```

---

## Step 3: Create Hetzner API Failover Script

This script monitors HAProxy health and automatically reassigns the Floating IP to the next available server if failover is needed.

Create `/etc/haproxy/hetzner-failover.sh` on **all three HAProxy servers**:

<details>
<summary>HAProxy 1 - /etc/haproxy/hetzner-failover.sh</summary>

```bash
#!/bin/bash

# Configuration
HETZNER_API_TOKEN="${HETZNER_API_TOKEN}"
FLOATING_IP_ID="${FLOATING_IP_ID}"
MY_SERVER_ID="${SERVER_ID_1}"
PRIORITY_SERVERS="${SERVER_ID_2} ${SERVER_ID_3}"
CHECK_INTERVAL=5
HAProxy_PORT=5432

LOG_FILE="/var/log/haproxy-failover.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if HAProxy is healthy
check_haproxy() {
    # Check if HAProxy process is running
    if ! pidof haproxy > /dev/null; then
        log "ERROR: HAProxy process not running"
        return 1
    fi

    # Check if HAProxy is listening on the port
    if ! ss -ltn | grep -q ":${HAProxy_PORT}"; then
        log "ERROR: HAProxy not listening on port ${HAProxy_PORT}"
        return 1
    fi

    # Check if at least one backend is healthy
    BACKEND_STATUS=$(echo "show stat" | socat stdio /run/haproxy/admin.sock 2>/dev/null | grep postgres_backend | grep -v "^#" | head -1)
    if [ -z "$BACKEND_STATUS" ]; then
        log "WARNING: Could not get backend status"
        return 0
    fi

    # Check if any backend is UP (column 18 in stats)
    BACKEND_UP=$(echo "$BACKEND_STATUS" | awk -F',' '{print $18}')
    if [[ "$BACKEND_UP" != *"UP"* ]]; then
        log "WARNING: No healthy backends found"
    fi

    return 0
}

# Get current server assigned to Floating IP
get_current_floating_ip_server() {
    curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID" | \
        jq -r '.floating_ip.server // "null"'
}

# Reassign Floating IP to a server
assign_floating_ip() {
    local TARGET_SERVER_ID=$1
    log "Attempting to assign Floating IP to server $TARGET_SERVER_ID"

    RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"server\": $TARGET_SERVER_ID}" \
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID/actions/assign")

    if echo "$RESPONSE" | jq -e '.error' > /dev/null; then
        log "ERROR: Failed to assign Floating IP: $RESPONSE"
        return 1
    else
        log "SUCCESS: Floating IP assigned to server $TARGET_SERVER_ID"
        return 0
    fi
}

# Main failover logic
perform_failover() {
    log "Starting failover process..."

    # Try each server in priority order
    for SERVER in $PRIORITY_SERVERS; do
        log "Checking if server $SERVER can take over..."

        # For remote server check, we could use hcloud CLI or API
        # For now, just assign and let the health check on that server handle it
        if assign_floating_ip "$SERVER"; then
            log "Failover completed to server $SERVER"
            return 0
        fi
    done

    log "ERROR: Failover failed - no servers available"
    return 1
}

# Main loop
log "Starting Hetzner Floating IP failover monitoring on server $MY_SERVER_ID"

while true; do
    # Check current Floating IP assignment
    CURRENT_SERVER=$(get_current_floating_ip_server)

    # Only act if Floating IP is assigned to this server
    if [ "$CURRENT_SERVER" != "null" ] && [ "$CURRENT_SERVER" == "$MY_SERVER_ID" ]; then
        if ! check_haproxy; then
            log "HAProxy health check failed on current owner"
            perform_failover
        fi
    fi

    sleep $CHECK_INTERVAL
done
```
</details>

<details>
<summary>HAProxy 2 - /etc/haproxy/hetzner-failover.sh</summary>

```bash
#!/bin/bash

# Configuration
HETZNER_API_TOKEN="${HETZNER_API_TOKEN}"
FLOATING_IP_ID="${FLOATING_IP_ID}"
MY_SERVER_ID="${SERVER_ID_2}"
PRIORITY_SERVERS="${SERVER_ID_3} ${SERVER_ID_1}"
CHECK_INTERVAL=5
HAProxy_PORT=5432

LOG_FILE="/var/log/haproxy-failover.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if HAProxy is healthy
check_haproxy() {
    # Check if HAProxy process is running
    if ! pidof haproxy > /dev/null; then
        log "ERROR: HAProxy process not running"
        return 1
    fi

    # Check if HAProxy is listening on the port
    if ! ss -ltn | grep -q ":${HAProxy_PORT}"; then
        log "ERROR: HAProxy not listening on port ${HAProxy_PORT}"
        return 1
    fi

    # Check if at least one backend is healthy
    BACKEND_STATUS=$(echo "show stat" | socat stdio /run/haproxy/admin.sock 2>/dev/null | grep postgres_backend | grep -v "^#" | head -1)
    if [ -z "$BACKEND_STATUS" ]; then
        log "WARNING: Could not get backend status"
        return 0
    fi

    # Check if any backend is UP (column 18 in stats)
    BACKEND_UP=$(echo "$BACKEND_STATUS" | awk -F',' '{print $18}')
    if [[ "$BACKEND_UP" != *"UP"* ]]; then
        log "WARNING: No healthy backends found"
    fi

    return 0
}

# Get current server assigned to Floating IP
get_current_floating_ip_server() {
    curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID" | \
        jq -r '.floating_ip.server // "null"'
}

# Reassign Floating IP to a server
assign_floating_ip() {
    local TARGET_SERVER_ID=$1
    log "Attempting to assign Floating IP to server $TARGET_SERVER_ID"

    RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"server\": $TARGET_SERVER_ID}" \
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID/actions/assign")

    if echo "$RESPONSE" | jq -e '.error' > /dev/null; then
        log "ERROR: Failed to assign Floating IP: $RESPONSE"
        return 1
    else
        log "SUCCESS: Floating IP assigned to server $TARGET_SERVER_ID"
        return 0
    fi
}

# Main failover logic
perform_failover() {
    log "Starting failover process..."

    # Try each server in priority order
    for SERVER in $PRIORITY_SERVERS; do
        log "Checking if server $SERVER can take over..."

        # For remote server check, we could use hcloud CLI or API
        # For now, just assign and let the health check on that server handle it
        if assign_floating_ip "$SERVER"; then
            log "Failover completed to server $SERVER"
            return 0
        fi
    done

    log "ERROR: Failover failed - no servers available"
    return 1
}

# Main loop
log "Starting Hetzner Floating IP failover monitoring on server $MY_SERVER_ID"

while true; do
    # Check current Floating IP assignment
    CURRENT_SERVER=$(get_current_floating_ip_server)

    # Only act if Floating IP is assigned to this server
    if [ "$CURRENT_SERVER" != "null" ] && [ "$CURRENT_SERVER" == "$MY_SERVER_ID" ]; then
        if ! check_haproxy; then
            log "HAProxy health check failed on current owner"
            perform_failover
        fi
    fi

    sleep $CHECK_INTERVAL
done
```
</details>

<details>
<summary>HAProxy 3 - /etc/haproxy/hetzner-failover.sh</summary>

```bash
#!/bin/bash

# Configuration
HETZNER_API_TOKEN="${HETZNER_API_TOKEN}"
FLOATING_IP_ID="${FLOATING_IP_ID}"
MY_SERVER_ID="${SERVER_ID_3}"
PRIORITY_SERVERS="${SERVER_ID_1} ${SERVER_ID_2}"
CHECK_INTERVAL=5
HAProxy_PORT=5432

LOG_FILE="/var/log/haproxy-failover.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if HAProxy is healthy
check_haproxy() {
    # Check if HAProxy process is running
    if ! pidof haproxy > /dev/null; then
        log "ERROR: HAProxy process not running"
        return 1
    fi

    # Check if HAProxy is listening on the port
    if ! ss -ltn | grep -q ":${HAProxy_PORT}"; then
        log "ERROR: HAProxy not listening on port ${HAProxy_PORT}"
        return 1
    fi

    # Check if at least one backend is healthy
    BACKEND_STATUS=$(echo "show stat" | socat stdio /run/haproxy/admin.sock 2>/dev/null | grep postgres_backend | grep -v "^#" | head -1)
    if [ -z "$BACKEND_STATUS" ]; then
        log "WARNING: Could not get backend status"
        return 0
    fi

    # Check if any backend is UP (column 18 in stats)
    BACKEND_UP=$(echo "$BACKEND_STATUS" | awk -F',' '{print $18}')
    if [[ "$BACKEND_UP" != *"UP"* ]]; then
        log "WARNING: No healthy backends found"
    fi

    return 0
}

# Get current server assigned to Floating IP
get_current_floating_ip_server() {
    curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID" | \
        jq -r '.floating_ip.server // "null"'
}

# Reassign Floating IP to a server
assign_floating_ip() {
    local TARGET_SERVER_ID=$1
    log "Attempting to assign Floating IP to server $TARGET_SERVER_ID"

    RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"server\": $TARGET_SERVER_ID}" \
        "https://api.hetzner.cloud/v1/floating_ips/$FLOATING_IP_ID/actions/assign")

    if echo "$RESPONSE" | jq -e '.error' > /dev/null; then
        log "ERROR: Failed to assign Floating IP: $RESPONSE"
        return 1
    else
        log "SUCCESS: Floating IP assigned to server $TARGET_SERVER_ID"
        return 0
    fi
}

# Main failover logic
perform_failover() {
    log "Starting failover process..."

    # Try each server in priority order
    for SERVER in $PRIORITY_SERVERS; do
        log "Checking if server $SERVER can take over..."

        # For remote server check, we could use hcloud CLI or API
        # For now, just assign and let the health check on that server handle it
        if assign_floating_ip "$SERVER"; then
            log "Failover completed to server $SERVER"
            return 0
        fi
    done

    log "ERROR: Failover failed - no servers available"
    return 1
}

# Main loop
log "Starting Hetzner Floating IP failover monitoring on server $MY_SERVER_ID"

while true; do
    # Check current Floating IP assignment
    CURRENT_SERVER=$(get_current_floating_ip_server)

    # Only act if Floating IP is assigned to this server
    if [ "$CURRENT_SERVER" != "null" ] && [ "$CURRENT_SERVER" == "$MY_SERVER_ID" ]; then
        if ! check_haproxy; then
            log "HAProxy health check failed on current owner"
            perform_failover
        fi
    fi

    sleep $CHECK_INTERVAL
done
```
</details>

---

## Step 4: Setup Failover Script Permissions and Service

Run on **all three HAProxy servers**:

```bash
# Make script executable
sudo chmod +x /etc/haproxy/hetzner-failover.sh

# Create log file
sudo touch /var/log/haproxy-failover.log
sudo chmod 644 /var/log/haproxy-failover.log

# Create systemd service for the failover script
sudo nano /etc/systemd/system/haproxy-failover.service
```

Add the following content to the service file:

```ini
[Unit]
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
WantedBy=multi-user.target
```

Then enable and start the service:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable failover service
sudo systemctl enable haproxy-failover

# Start failover service
sudo systemctl start haproxy-failover
```

---

## Step 5: Enable HAProxy Stats Socket (Required for Failover Script)

Run on **all three HAProxy servers** to enable the stats socket that the failover script uses to check backend health.

Edit `/etc/haproxy/haproxy.cfg` and add the following in the `global` section:

```haproxy
global
    # ... existing settings ...
    stats socket /run/haproxy/admin.sock mode 600 level user
```

Then reload HAProxy:

```bash
sudo systemctl reload haproxy
```

---

## Service Management

### Start/Stop Services

```bash
# HAProxy
sudo systemctl start haproxy
sudo systemctl stop haproxy
sudo systemctl restart haproxy
sudo systemctl reload haproxy

# Failover Monitor
sudo systemctl start haproxy-failover
sudo systemctl stop haproxy-failover
sudo systemctl restart haproxy-failover
```

### Check Service Status

```bash
# Check HAProxy status
sudo systemctl status haproxy

# Check failover monitor status
sudo systemctl status haproxy-failover

# View failover logs
sudo journalctl -u haproxy-failover -f

# View failover log file
sudo tail -f /var/log/haproxy-failover.log

# View HAProxy statistics
echo "show stat" | socat stdio /run/haproxy/admin.sock
```

---

## Verification

### Verify HAProxy Backend Health

```bash
# Check HAProxy stats for backend status
echo "show stat" | socat stdio /run/haproxy/admin.sock | grep postgres_backend

# Check detailed backend info
echo "show stat" | socat stdio /run/haproxy/admin.sock | csvcut -c 1,18,36
```

### Verify Floating IP Assignment via API

```bash
# Using curl and jq
curl -s -H "Authorization: Bearer ${HETZNER_API_TOKEN}" \
    "https://api.hetzner.cloud/v1/floating_ips/${FLOATING_IP_ID}" | \
    jq '.floating_ip'

# Check which server has the Floating IP
curl -s -H "Authorization: Bearer ${HETZNER_API_TOKEN}" \
    "https://api.hetzner.cloud/v1/floating_ips/${FLOATING_IP_ID}" | \
    jq -r '.floating_ip.server'
```

### Test Database Connection via Floating IP

```bash
# Test connection to PostgreSQL through Floating IP
psql -h ${FLOATING_IP} -p 5432 -U postgres

# Test with connection string
psql "host=${FLOATING_IP} port=5432 user=postgres"
```

### Test Failover

```bash
# Stop HAProxy on the server that currently has the Floating IP
sudo systemctl stop haproxy

# Wait a few seconds and check that Floating IP moved to another server
curl -s -H "Authorization: Bearer ${HETZNER_API_TOKEN}" \
    "https://api.hetzner.cloud/v1/floating_ips/${FLOATING_IP_ID}" | \
    jq -r '.floating_ip.server'

# Check failover logs
sudo tail -20 /var/log/haproxy-failover.log

# Restart HAProxy on the original server
sudo systemctl start haproxy
```

---

## Port Reference

| Port | Service | Description |
|------|---------|-------------|
| 5432 | HAProxy Frontend | Incoming PostgreSQL client connections |
| 8008 | Backend Check | Patroni REST API health check port |
| 8404 | HAProxy Stats | Statistics page (if enabled) |

---

## Getting Required Information from Hetzner

### Get Hetzner API Token

1. Go to https://console.hetzner.cloud/
2. Go to Security > API Tokens
3. Create a new token with Read & Write permissions
4. Save the token securely

### Get Floating IP ID

```bash
# List all Floating IPs
curl -s -H "Authorization: Bearer ${HETZNER_API_TOKEN}" \
    "https://api.hetzner.cloud/v1/floating_ips" | \
    jq '.floating_ips[] | {id: .id, ip: .ip, description: .description}'
```

### Get Server IDs

```bash
# List all servers
curl -s -H "Authorization: Bearer ${HETZNER_API_TOKEN}" \
    "https://api.hetzner.cloud/v1/servers" | \
    jq '.servers[] | {id: .id, name: .name, public_ip: .public_net.ipv4.ip}'
```

Or using hcloud CLI (if installed):

```bash
# List Floating IPs
hcloud floating-ip list

# List servers
hcloud server list

# Get specific Floating IP details
hcloud floating-ip describe <FLOATING_IP>
```

---

## Security Considerations

1. **Protect API Token:** Never commit the API token to version control
2. **Limit API Token Scope:** Use minimum required permissions
3. **Firewall Rules:** Restrict access to HAProxy ports
4. **Log Monitoring:** Monitor failover logs for unusual activity
5. **SSL/TLS:** Use SSL for database connections
6. **API Token Rotation:** Regularly rotate API tokens
7. **Network Isolation:** Use Hetzner private networks for backend communication

---

## Troubleshooting

### Floating IP not assigned

```bash
# Check failover script logs
sudo tail -50 /var/log/haproxy-failover.log

# Check systemd service status
sudo systemctl status haproxy-failover

# Manually test API connection
curl -s -H "Authorization: Bearer ${HETZNER_API_TOKEN}" \
    "https://api.hetzner.cloud/v1/floating_ips"
```

### Backend marked as down

```bash
# Check if Patroni REST API is accessible from HAProxy server
curl -k https://${IP_ADDRESS_NODE_1_POSTGRESQL}:8008/patroni

# Check HAProxy configuration for syntax errors
sudo haproxy -c -f /etc/haproxy/haproxy.cfg

# Check HAProxy logs
sudo tail -f /var/log/haproxy.log
```

### Failover script not working

```bash
# Test script manually (run in foreground for debugging)
sudo bash -x /etc/haproxy/hetzner-failover.sh

# Check if socat can access stats socket
echo "show stat" | socat stdio /run/haproxy/admin.sock

# Verify API token works
curl -s -H "Authorization: Bearer ${HETZNER_API_TOKEN}" \
    "https://api.hetzner.cloud/v1/floating_ips/${FLOATING_IP_ID}"
```

### Stats socket permission denied

```bash
# Check socket exists
ls -la /run/haproxy/admin.sock

# Check HAProxy user has permissions
sudo -u haproxy socat stdio /run/haproxy/admin.sock
```
