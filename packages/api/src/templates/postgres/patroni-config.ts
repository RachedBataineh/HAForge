export function patroniConfigContent(
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
      username: \${SUPERUSER_USERNAME}
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
