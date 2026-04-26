export function haproxyConfigContent() {
  return `frontend postgres_frontend
    bind *:5432
    mode tcp
    default_backend postgres_backend

backend postgres_backend
    mode tcp
    balance leastconn
    option tcp-check
    option httpchk GET /primary
    http-check expect status 200
    option redispatch
    retries 3
    timeout connect 5s
    timeout server 30s
    timeout tunnel 1h
    default-server maxconn 100
    server postgresql-01 \${PRIVATE_IP_NODE_1}:5432 port 8008 check check-ssl ca-file /etc/haproxy/ca.crt verify required inter 5000 fall 3 rise 2
    server postgresql-02 \${PRIVATE_IP_NODE_2}:5432 port 8008 check check-ssl ca-file /etc/haproxy/ca.crt verify required inter 5000 fall 3 rise 2
    server postgresql-03 \${PRIVATE_IP_NODE_3}:5432 port 8008 check check-ssl ca-file /etc/haproxy/ca.crt verify required inter 5000 fall 3 rise 2
`;
}

export const CHECK_HAPROXY_SCRIPT = `#!/bin/bash
if ! pidof haproxy > /dev/null; then
    exit 1
fi
if ! ss -ltn | grep -q ":5432"; then
    exit 1
fi
exit 0`;

export const NETPLAN_FLOATING_IP = `network:
  version: 2
  ethernets:
    enp7s0:
      addresses:
        - \${FLOATING_IP}/32
`;
