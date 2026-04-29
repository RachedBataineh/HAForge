import type { TargetRole, FileStep } from "../templates/cluster-steps";

export type PatchPhase = "hardening" | "postgres" | "haproxy" | "monitoring";

export interface PatchDefinition {
  id: string;
  name: string;
  description: string;
  phase: PatchPhase;
  targetRole: TargetRole;
  commands: string[];
  files?: FileStep[];
  validation?: string;
}
