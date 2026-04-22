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
        auth_pass HAForgeCluster
    }

    virtual_ipaddress {
        \${FLOATING_IP}/32 dev eth0
    }

    track_script {
        check_haproxy
    }

    notify_master /etc/keepalived/failover.sh}`;
}

export function failoverScriptContent(myServerId: string) {
  return `#!/bin/bash
HETZNER_TOKEN="\${HETZNER_API_TOKEN}"
FLOATING_IP_ID="\${FLOATING_IP_ID}"
MY_SERVER_ID="${myServerId}"

echo "$(date): notify_master fired - assigning floating IP to ${myServerId}" >> /var/log/keepalived-failover.log

curl -s -X POST \\
  "https://api.hetzner.cloud/v1/floating_ips/\${FLOATING_IP_ID}/actions/assign" \\
  -H "Authorization: Bearer \${HETZNER_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"server\\": \${MY_SERVER_ID}}" >> /var/log/keepalived-failover.log 2>&1`;
}
