# PostgreSQL High-Availability Cluster

A highly available PostgreSQL cluster using Patroni for automatic failover and etcd for distributed configuration store. This setup deploys 3 nodes with automatic leader election and replication.

## Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │           etcd Cluster              │
                    │   (Distributed Configuration Store)  │
                    └─────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
              ┌─────▼─────┐     ┌────▼────┐     ┌─────▼─────┐
              │  Node 01  │     │ Node 02 │     │  Node 03  │
              │  Primary  │◄────┤ Replica │◄────┤  Replica  │
              │  Patroni  │     │ Patroni │     │  Patroni  │
              │ PostgreSQL│     │PostgreSQL│     │ PostgreSQL│
              └───────────┘     └─────────┘     └───────────┘
                    │                 │                 │
                    └─────────────────┴─────────────────┘
                                      │
                               Port 5432 (PostgreSQL)
                               Port 8008 (Patroni REST API)
```

## Variables

| Variable | Description |
|----------|-------------|
| `${IP_ADDRESS_NODE_1}` | IP address of first PostgreSQL node |
| `${IP_ADDRESS_NODE_2}` | IP address of second PostgreSQL node |
| `${IP_ADDRESS_NODE_3}` | IP address of third PostgreSQL node |

## Prerequisites

- **Operating System:** Ubuntu/Debian Linux
- **Network:** All nodes must be able to communicate on ports 2379, 2380 (etcd), 5432 (PostgreSQL), and 8008 (Patroni REST API)
- **Certificates:** SSL certificates required for etcd and PostgreSQL (see Step 2, items 10-12 and Step 2, item 27-29)
- **Permissions:** Root or sudo access on all nodes

---

## Step 1: Install PostgreSQL

Run these commands on **all three nodes**.

```bash
# Update package lists
sudo apt update

# Install PostgreSQL repository setup tool
sudo apt install -y postgresql-common

# Add official PostgreSQL repository
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh

# Update package lists again
sudo apt update

# Install PostgreSQL server and contrib extensions
sudo apt install -y postgresql postgresql-contrib

# Stop and disable PostgreSQL (Patroni will manage it)
sudo systemctl stop postgresql
sudo systemctl disable postgresql
```

---

## Step 2: Install etcd

Run these commands on **all three nodes**.

### 2.1 Download and Install etcd Binary

```bash
# Install required tools
sudo apt update
sudo apt-get install -y wget curl

# Download etcd v3.6.10
wget https://github.com/etcd-io/etcd/releases/download/v3.6.10/etcd-v3.6.10-linux-amd64.tar.gz

# Extract archive
tar xvf etcd-v3.6.10-linux-amd64.tar.gz

# Move to etcd directory
mv etcd-v3.6.10-linux-amd64 etcd

# Install binaries to system path
sudo mv etcd/etcd* /usr/local/bin/

# Create etcd user
sudo useradd --system --home /var/lib/etcd --shell /bin/false etcd
```

### 2.2 Setup SSL Certificates

```bash
# Create directories
sudo mkdir -p /etc/etcd
sudo mkdir -p /etc/etcd/ssl

# Move certificates (assumes pre-generated certs in /tmp)
sudo mv /tmp/etcd-node*.crt /etc/etcd/ssl/
sudo mv /tmp/etcd-node*.key /etc/etcd/ssl/
sudo mv /tmp/ca.crt /etc/etcd/ssl/

# Set ownership and permissions
sudo chown -R etcd:etcd /etc/etcd/
sudo chmod 600 /etc/etcd/ssl/etcd-node*.key
sudo chmod 644 /etc/etcd/ssl/etcd-node*.crt /etc/etcd/ssl/ca.crt
```

### 2.3 Configure etcd Environment

Create the file `/etc/etcd/etcd.env` with node-specific configuration:

<details>
<summary>Node 1 - /etc/etcd/etcd.env</summary>

```bash
ETCD_NAME="postgresql-01"
ETCD_DATA_DIR="/var/lib/etcd"
ETCD_INITIAL_CLUSTER="postgresql-01=https://${IP_ADDRESS_NODE_1}:2380,postgresql-02=https://${IP_ADDRESS_NODE_2}:2380,postgresql-03=https://${IP_ADDRESS_NODE_3}:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="etcd-cluster"
ETCD_INITIAL_ADVERTISE_PEER_URLS="https://${IP_ADDRESS_NODE_1}:2380"
ETCD_LISTEN_PEER_URLS="https://0.0.0.0:2380"
ETCD_LISTEN_CLIENT_URLS="https://0.0.0.0:2379"
ETCD_ADVERTISE_CLIENT_URLS="https://${IP_ADDRESS_NODE_1}:2379"
ETCD_CLIENT_CERT_AUTH="true"
ETCD_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_CERT_FILE="/etc/etcd/ssl/etcd-node1.crt"
ETCD_KEY_FILE="/etc/etcd/ssl/etcd-node1.key"
ETCD_PEER_CLIENT_CERT_AUTH="true"
ETCD_PEER_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_PEER_CERT_FILE="/etc/etcd/ssl/etcd-node1.crt"
ETCD_PEER_KEY_FILE="/etc/etcd/ssl/etcd-node1.key"
```
</details>

<details>
<summary>Node 2 - /etc/etcd/etcd.env</summary>

```bash
ETCD_NAME="postgresql-02"
ETCD_DATA_DIR="/var/lib/etcd"
ETCD_INITIAL_CLUSTER="postgresql-01=https://${IP_ADDRESS_NODE_1}:2380,postgresql-02=https://${IP_ADDRESS_NODE_2}:2380,postgresql-03=https://${IP_ADDRESS_NODE_3}:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="etcd-cluster"
ETCD_INITIAL_ADVERTISE_PEER_URLS="https://${IP_ADDRESS_NODE_2}:2380"
ETCD_LISTEN_PEER_URLS="https://0.0.0.0:2380"
ETCD_LISTEN_CLIENT_URLS="https://0.0.0.0:2379"
ETCD_ADVERTISE_CLIENT_URLS="https://${IP_ADDRESS_NODE_2}:2379"
ETCD_CLIENT_CERT_AUTH="true"
ETCD_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_CERT_FILE="/etc/etcd/ssl/etcd-node2.crt"
ETCD_KEY_FILE="/etc/etcd/ssl/etcd-node2.key"
ETCD_PEER_CLIENT_CERT_AUTH="true"
ETCD_PEER_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_PEER_CERT_FILE="/etc/etcd/ssl/etcd-node2.crt"
ETCD_PEER_KEY_FILE="/etc/etcd/ssl/etcd-node2.key"
```
</details>

<details>
<summary>Node 3 - /etc/etcd/etcd.env</summary>

```bash
ETCD_NAME="postgresql-03"
ETCD_DATA_DIR="/var/lib/etcd"
ETCD_INITIAL_CLUSTER="postgresql-01=https://${IP_ADDRESS_NODE_1}:2380,postgresql-02=https://${IP_ADDRESS_NODE_2}:2380,postgresql-03=https://${IP_ADDRESS_NODE_3}:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="etcd-cluster"
ETCD_INITIAL_ADVERTISE_PEER_URLS="https://${IP_ADDRESS_NODE_3}:2380"
ETCD_LISTEN_PEER_URLS="https://0.0.0.0:2380"
ETCD_LISTEN_CLIENT_URLS="https://0.0.0.0:2379"
ETCD_ADVERTISE_CLIENT_URLS="https://${IP_ADDRESS_NODE_3}:2379"
ETCD_CLIENT_CERT_AUTH="true"
ETCD_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_CERT_FILE="/etc/etcd/ssl/etcd-node3.crt"
ETCD_KEY_FILE="/etc/etcd/ssl/etcd-node3.key"
ETCD_PEER_CLIENT_CERT_AUTH="true"
ETCD_PEER_TRUSTED_CA_FILE="/etc/etcd/ssl/ca.crt"
ETCD_PEER_CERT_FILE="/etc/etcd/ssl/etcd-node3.crt"
ETCD_PEER_KEY_FILE="/etc/etcd/ssl/etcd-node3.key"
```
</details>

### 2.4 Create etcd Systemd Service

Create `/etc/systemd/system/etcd.service` on **all nodes**:

```ini
[Unit]
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
WantedBy=multi-user.target
```

### 2.5 Start etcd Service

```bash
# Create data directory
sudo mkdir -p /var/lib/etcd
sudo chown -R etcd:etcd /var/lib/etcd

# Reload systemd and enable etcd
sudo systemctl daemon-reload
sudo systemctl enable etcd

# Start etcd
sudo systemctl start etcd

# Restart to ensure clean state
sudo systemctl restart etcd

# Add user to etcd group for certificate access
sudo usermod -aG etcd $USER
```

---

## Step 3: Setup PostgreSQL SSL Certificates

Run these commands on **all three nodes**.

```bash
# Create directories
sudo mkdir -p /var/lib/postgresql/data
sudo mkdir -p /var/lib/postgresql/ssl

# From /tmp directory, move SSL certificates
cd /tmp
sudo chmod 600 server.key
sudo mv server.crt server.key server.req /var/lib/postgresql/ssl

# Set permissions
sudo chmod 600 /var/lib/postgresql/ssl/server.key
sudo chmod 644 /var/lib/postgresql/ssl/server.crt
sudo chmod 600 /var/lib/postgresql/ssl/server.req

# Set ownership
sudo chown postgres:postgres /var/lib/postgresql/data
sudo chown postgres:postgres /var/lib/postgresql/ssl/server.*

# Grant postgres user read access to etcd certificates
sudo apt update
sudo apt install -y acl
sudo setfacl -m u:postgres:r /etc/etcd/ssl/ca.crt
sudo setfacl -m u:postgres:r /etc/etcd/ssl/etcd-node*.crt
sudo setfacl -m u:postgres:r /etc/etcd/ssl/etcd-node*.key
```

---

## Step 4: Install and Configure Patroni

### 4.1 Install Patroni

Run on **all three nodes**:

```bash
sudo apt install -y patroni
sudo mkdir -p /etc/patroni/
```

### 4.2 Configure Patroni

Create `/etc/patroni/config.yml` with node-specific configuration:

<details>
<summary>Node 1 - /etc/patroni/config.yml</summary>

```yaml
scope: postgresql-cluster
namespace: /service/
name: postgresql-01

etcd3:
  hosts: ${IP_ADDRESS_NODE_1}:2379,${IP_ADDRESS_NODE_2}:2379,${IP_ADDRESS_NODE_3}:2379
  protocol: https
  cacert: /etc/etcd/ssl/ca.crt
  cert: /etc/etcd/ssl/etcd-node1.crt
  key: /etc/etcd/ssl/etcd-node1.key

restapi:
  listen: 0.0.0.0:8008
  connect_address: ${IP_ADDRESS_NODE_1}:8008
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
        - hostssl replication replicator ${IP_ADDRESS_NODE_1}/32 md5
        - hostssl replication replicator ${IP_ADDRESS_NODE_2}/32 md5
        - hostssl replication replicator ${IP_ADDRESS_NODE_3}/32 md5
        - hostssl all all 127.0.0.1/32 md5
        - hostssl all all 0.0.0.0/0 md5
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${IP_ADDRESS_NODE_1}:5432
  data_dir: /var/lib/postgresql/data
  bin_dir: /usr/lib/postgresql/17/bin
  authentication:
    superuser:
      username: postgres
      password: cnV2abjbDpbh64e12987wR4mj5kQ3456Y0Qf
    replication:
      username: replicator
      password: sad9a23jga8jsuedrwtsskj74567suiuwe23
  parameters:
    max_connections: 100
    shared_buffers: 256MB

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false
```
</details>

<details>
<summary>Node 2 - /etc/patroni/config.yml</summary>

```yaml
scope: postgresql-cluster
namespace: /service/
name: postgresql-02

etcd3:
  hosts: ${IP_ADDRESS_NODE_1}:2379,${IP_ADDRESS_NODE_2}:2379,${IP_ADDRESS_NODE_3}:2379
  protocol: https
  cacert: /etc/etcd/ssl/ca.crt
  cert: /etc/etcd/ssl/etcd-node2.crt
  key: /etc/etcd/ssl/etcd-node2.key

restapi:
  listen: 0.0.0.0:8008
  connect_address: ${IP_ADDRESS_NODE_2}:8008
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
        - hostssl replication replicator ${IP_ADDRESS_NODE_1}/32 md5
        - hostssl replication replicator ${IP_ADDRESS_NODE_2}/32 md5
        - hostssl replication replicator ${IP_ADDRESS_NODE_3}/32 md5
        - hostssl all all 127.0.0.1/32 md5
        - hostssl all all 0.0.0.0/0 md5
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${IP_ADDRESS_NODE_2}:5432
  data_dir: /var/lib/postgresql/data
  bin_dir: /usr/lib/postgresql/17/bin
  authentication:
    superuser:
      username: postgres
      password: cnV2abjbDpbh64e12987wR4mj5kQ3456Y0Qf
    replication:
      username: replicator
      password: sad9a23jga8jsuedrwtsskj74567suiuwe23
  parameters:
    max_connections: 100
    shared_buffers: 256MB

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false
```
</details>

<details>
<summary>Node 3 - /etc/patroni/config.yml</summary>

```yaml
scope: postgresql-cluster
namespace: /service/
name: postgresql-03

etcd3:
  hosts: ${IP_ADDRESS_NODE_1}:2379,${IP_ADDRESS_NODE_2}:2379,${IP_ADDRESS_NODE_3}:2379
  protocol: https
  cacert: /etc/etcd/ssl/ca.crt
  cert: /etc/etcd/ssl/etcd-node3.crt
  key: /etc/etcd/ssl/etcd-node3.key

restapi:
  listen: 0.0.0.0:8008
  connect_address: ${IP_ADDRESS_NODE_3}:8008
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
        - hostssl replication replicator ${IP_ADDRESS_NODE_1}/32 md5
        - hostssl replication replicator ${IP_ADDRESS_NODE_2}/32 md5
        - hostssl replication replicator ${IP_ADDRESS_NODE_3}/32 md5
        - hostssl all all 127.0.0.1/32 md5
        - hostssl all all 0.0.0.0/0 md5
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${IP_ADDRESS_NODE_3}:5432
  data_dir: /var/lib/postgresql/data
  bin_dir: /usr/lib/postgresql/17/bin
  authentication:
    superuser:
      username: postgres
      password: "cnV2abjbDpbh64e12987wR4mj5kQ3456Y0Qf"
    replication:
      username: replicator
      password: sad9a23jga8jsuedrwtsskj74567suiuwe23
  parameters:
    max_connections: 100
    shared_buffers: 256MB

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false
```
</details>

### 4.3 Finalize Patroni Setup

Run on **all three nodes**:

```bash
# Create combined PEM file for REST API
sudo sh -c 'cat /var/lib/postgresql/ssl/server.crt /var/lib/postgresql/ssl/server.key > /var/lib/postgresql/ssl/server.pem'
sudo chown postgres:postgres /var/lib/postgresql/ssl/server.pem
sudo chmod 600 /var/lib/postgresql/ssl/server.pem

# Verify certificate
sudo openssl x509 -in /var/lib/postgresql/ssl/server.pem -text -noout

# Start Patroni
sudo systemctl restart patroni
```

**Important:** After the first node is initialized, update etcd on all remaining nodes to use "existing" cluster state:

```bash
sudo sed -i 's/ETCD_INITIAL_CLUSTER_STATE="new"/ETCD_INITIAL_CLUSTER_STATE="existing"/' /etc/etcd/etcd.env
```

---

## Service Management

### Start/Stop Services

```bash
# Patroni (manages PostgreSQL)
sudo systemctl start patroni
sudo systemctl stop patroni
sudo systemctl restart patroni

# etcd
sudo systemctl start etcd
sudo systemctl stop etcd
sudo systemctl restart etcd
```

### Check Service Status

```bash
# Check Patroni status
sudo systemctl status patroni

# Check etcd status
sudo systemctl status etcd

# View Patroni cluster status
patronictl -c /etc/patroni/config.yml list

# View cluster configuration
patronictl -c /etc/patroni/config.yml show-config
```

---

## Verification

### Verify etcd Cluster Health

```bash
# Check etcd member list
ETCDCTL_API=3 etcdctl --endpoints=https://${IP_ADDRESS_NODE_1}:2379 \
  --cacert=/etc/etcd/ssl/ca.crt \
  --cert=/etc/etcd/ssl/etcd-node1.crt \
  --key=/etc/etcd/ssl/etcd-node1.key \
  member list
```

### Verify PostgreSQL Cluster

```bash
# Check cluster members
patronictl -c /etc/patroni/config.yml list

# Check replication status
sudo -u postgres psql -c "SELECT * FROM pg_stat_replication;"

# Check current role (primary or replica)
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
```

### Test Connectivity

```bash
# Test PostgreSQL connection
psql -h ${IP_ADDRESS_NODE_1} -p 5432 -U postgres

# Test Patroni REST API
curl -k https://${IP_ADDRESS_NODE_1}:8008/patroni
```

---

## Port Reference

| Port | Service | Description |
|------|---------|-------------|
| 5432 | PostgreSQL | Database client connections |
| 8008 | Patroni | REST API for health checks and management |
| 2379 | etcd | Client requests |
| 2380 | etcd | Peer communication |
