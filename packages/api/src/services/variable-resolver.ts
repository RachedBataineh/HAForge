export interface VariableMap {
  // PostgreSQL nodes (public IPs)
  IP_ADDRESS_NODE_1: string;
  IP_ADDRESS_NODE_2: string;
  IP_ADDRESS_NODE_3: string;
  // HAProxy references to PG nodes (public IPs, kept for backward compat)
  IP_ADDRESS_NODE_1_POSTGRESQL: string;
  IP_ADDRESS_NODE_2_POSTGRESQL: string;
  IP_ADDRESS_NODE_3_POSTGRESQL: string;
  // PostgreSQL nodes (private IPs for HAProxy backend)
  PRIVATE_IP_NODE_1: string;
  PRIVATE_IP_NODE_2: string;
  PRIVATE_IP_NODE_3: string;
  // HAProxy nodes (public IPs for SSH)
  IP_ADDRESS_HAPROXY_1: string;
  IP_ADDRESS_HAPROXY_2: string;
  IP_ADDRESS_HAPROXY_3: string;
  // HAProxy nodes (private IPs for keepalived unicast VRRP)
  PRIVATE_IP_HAPROXY_1: string;
  PRIVATE_IP_HAPROXY_2: string;
  PRIVATE_IP_HAPROXY_3: string;
  // Hetzner
  FLOATING_IP: string;
  HETZNER_API_TOKEN: string;
  FLOATING_IP_ID: string;
  LOAD_BALANCER_ID: string;
  SERVER_ID_1: string;
  SERVER_ID_2: string;
  SERVER_ID_3: string;
  // Passwords
  SUPERUSER_PASSWORD: string;
  SUPERUSER_USERNAME: string;
  REPLICATION_PASSWORD: string;
  ADMIN_USERNAME: string;
  VRRP_AUTH_PASS: string;
}

export function resolveVariables(template: string, vars: Partial<VariableMap>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) {
      result = result.replaceAll(`\${${key}}`, value);
    }
  }
  return result;
}
