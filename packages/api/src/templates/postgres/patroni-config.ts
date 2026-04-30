import { PG_VERSION } from "./pg-version";

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
  certfile: /var/lib/postgresql/ssl/server.crt
  keyfile: /var/lib/postgresql/ssl/server.key

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
        password_encryption: scram-sha-256
      pg_hba:
        - local all all peer
        - hostssl replication replicator 127.0.0.1/32 scram-sha-256
        - hostssl replication replicator ${privateIp1}/32 scram-sha-256
        - hostssl replication replicator ${privateIp2}/32 scram-sha-256
        - hostssl replication replicator ${privateIp3}/32 scram-sha-256
        - hostssl all all 127.0.0.1/32 scram-sha-256
        - hostssl all all 0.0.0.0/0 scram-sha-256
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: 0.0.0.0:5432
  connect_address: ${selfPrivateIp}:5432
  data_dir: /var/lib/postgresql/data
  bin_dir: /usr/lib/postgresql/${PG_VERSION}/bin
  authentication:
    superuser:
      username: \${SUPERUSER_USERNAME}
      password: \${SUPERUSER_PASSWORD}
    replication:
      username: replicator
      password: \${REPLICATION_PASSWORD}
  parameters:
    password_encryption: scram-sha-256
    shared_buffers: __SHARED_BUFFERS__
    max_connections: __MAX_CONNECTIONS__
    work_mem: __WORK_MEM__
    effective_cache_size: __EFFECTIVE_CACHE_SIZE__
    maintenance_work_mem: __MAINTENANCE_WORK_MEM__
    wal_buffers: 64MB
    checkpoint_completion_target: 0.9
    default_statistics_target: 100
    shared_preload_libraries: pg_stat_statements
    pg_stat_statements.track: all
    pg_stat_statements.max: 10000
    logging_collector: 'on'
    log_directory: log
    log_filename: 'postgresql-%Y-%m-%d.log'
    log_rotation_age: '1d'
    log_min_duration_statement: 1000
    log_checkpoints: 'on'
    log_connections: 'on'
    log_disconnections: 'on'
    log_lock_waits: 'on'
    log_temp_files: 0

tags:
  nofailover: false
  noloadbalance: false
  clonefrom: false`;
}
