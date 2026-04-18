export interface VariableMap {
  // PostgreSQL nodes
  IP_ADDRESS_NODE_1: string;
  IP_ADDRESS_NODE_2: string;
  IP_ADDRESS_NODE_3: string;
  // HAProxy references to PG nodes
  IP_ADDRESS_NODE_1_POSTGRESQL: string;
  IP_ADDRESS_NODE_2_POSTGRESQL: string;
  IP_ADDRESS_NODE_3_POSTGRESQL: string;
  // Hetzner
  FLOATING_IP: string;
  HETZNER_API_TOKEN: string;
  FLOATING_IP_ID: string;
  SERVER_ID_1: string;
  SERVER_ID_2: string;
  SERVER_ID_3: string;
  // Passwords
  SUPERUSER_PASSWORD: string;
  REPLICATION_PASSWORD: string;
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
