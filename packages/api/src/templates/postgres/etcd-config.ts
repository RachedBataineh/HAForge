export function etcdEnvContent(
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

export const ETCD_SERVICE = `[Unit]
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
