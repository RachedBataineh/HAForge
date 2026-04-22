import type { StepDefinition, TargetRole } from "./types";
import { getPostgresSteps } from "./postgres/postgres-steps";
import { getHaproxySteps } from "./haproxy/haproxy-steps";

export type { TargetRole, StepDefinition, CommandStep, FileStep } from "./types";

export function getClusterSteps(): StepDefinition[] {
  const pgSteps = getPostgresSteps();
  const haSteps = getHaproxySteps();
  // Renumber HAProxy steps to continue after PostgreSQL (step 20+)
  const offset = pgSteps.length;
  const renumberedHa = haSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset,
  }));
  return [...pgSteps, ...renumberedHa];
}

export function getLbClusterSteps(): StepDefinition[] {
  return getPostgresSteps();
}
