export function keepalivedConfigContent(
  state: string,
  priority: number,
  privateIp: string,
  peerIps: string[],
) {
  const peers = peerIps.map(ip => `        ${ip}`).join("\n");
  return `global_defs {
    enable_script_security
    script_user root
}

vrrp_script check_haproxy {
    script "/etc/keepalived/check_haproxy.sh"
    interval 2
    fall 3
    rise 2
}

vrrp_instance VI_1 {
    state ${state}
    interface enp7s0
    virtual_router_id 51
    priority ${priority}
    advert_int 1

    unicast_src_ip ${privateIp}
    unicast_peer {
${peers}
    }

    authentication {
        auth_type PASS
        auth_pass \${VRRP_AUTH_PASS}
    }

    virtual_ipaddress {
        \${FLOATING_IP}/32 dev enp7s0
    }

    track_script {
        check_haproxy
    }

    notify_master /etc/keepalived/failover.sh}`;
}

export function failoverScriptContent() {
  return `#!/bin/bash
source /etc/keepalived/.env

echo "$(date): notify_master fired - assigning floating IP to server \${MY_SERVER_ID}" >> /var/log/keepalived-failover.log

RESPONSE=$(curl -s -w "\\n%{http_code}" -X POST \\
  "https://api.hetzner.cloud/v1/floating_ips/\${FLOATING_IP_ID}/actions/assign" \\
  -H "Authorization: Bearer \${HETZNER_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"server\\": \${MY_SERVER_ID}}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '\$d')

echo "$(date): HTTP $HTTP_CODE - $BODY" >> /var/log/keepalived-failover.log

if [ "$HTTP_CODE" -ne 200 ] && [ "$HTTP_CODE" -ne 201 ]; then
    echo "$(date): ERROR: Failed to assign floating IP (HTTP $HTTP_CODE)" >> /var/log/keepalived-failover.log
    exit 1
fi`;
}

export function keepalivedEnvContent(
  myServerId: string,
) {
  return `HETZNER_TOKEN="\${HETZNER_API_TOKEN}"
FLOATING_IP_ID="\${FLOATING_IP_ID}"
MY_SERVER_ID="${myServerId}"
`;
}
