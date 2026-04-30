import type { TargetRole, FileStep } from "../templates/cluster-steps";

export type PatchPhase = "hardening" | "postgres" | "haproxy" | "monitoring";

/**
 * A single step within a patch. Each step targets specific servers
 * and runs sequentially. Steps can have different targetRoles.
 */
export interface PatchStep {
  name: string;
  targetRole: TargetRole;
  commands: string[];
  files?: FileStep[];
  validation?: string;
  /** If false, a failure on this step won't abort the whole patch. Default: true */
  critical?: boolean;
}

/**
 * A patch definition. Supports two modes:
 *
 * 1. Simple patch (backward compatible): Just set `commands` + `targetRole`.
 *    Gets auto-wrapped into a single PatchStep.
 *
 * 2. Orchestrated patch: Set `steps[]` with multiple PatchSteps,
 *    each with its own targetRole. Steps run sequentially.
 *    Optionally set `discoverLeader` to true for patches that need
 *    to know which node is the Patroni leader (e.g. PG upgrades).
 */
export interface PatchDefinition {
  id: string;
  name: string;
  description: string;
  phase: PatchPhase;

  // Simple mode (single-step, backward compatible)
  targetRole?: TargetRole;
  commands?: string[];
  files?: FileStep[];
  validation?: string;

  // Orchestrated mode (multi-step)
  steps?: PatchStep[];

  /** If true, the patch runner will query Patroni API to discover the leader
   *  before running steps. Available in steps via the LEADER_ROLE variable. */
  discoverLeader?: boolean;
}
