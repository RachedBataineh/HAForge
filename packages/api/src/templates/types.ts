export type TargetRole =
  | "all_pg"
  | "all_ha"
  | "postgresql_1"
  | "postgresql_2"
  | "postgresql_3"
  | "haproxy_1"
  | "haproxy_2"
  | "haproxy_3";

export interface CommandStep {
  commands: string[];
}

export interface FileStep {
  path: string;
  content: string;
  owner?: string;
  permissions?: string;
}

export interface StepDefinition {
  phase: "postgres" | "haproxy";
  stepNumber: number;
  name: string;
  targetRole: TargetRole;
  commands: CommandStep[];
  files: FileStep[];
  validation?: string;
}
