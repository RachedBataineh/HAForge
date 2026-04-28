import type { StepDefinition } from "./types";
import { getPostgresSteps } from "./postgres/postgres-steps";
import { getHaproxySteps } from "./haproxy/haproxy-steps";
import { getHardeningSteps } from "./hardening/hardening-steps";

export type { TargetRole, StepDefinition, CommandStep, FileStep } from "./types";

export function getClusterSteps(): StepDefinition[] {
  const hardeningSteps = getHardeningSteps();
  const pgSteps = getPostgresSteps();
  const haSteps = getHaproxySteps();

  // Renumber: hardening, PG, HA -- offsets calculated dynamically
  const offset1 = hardeningSteps.length;
  const offset2 = offset1 + pgSteps.length;

  const renumberedPg = pgSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset1,
  }));
  const renumberedHa = haSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset2,
  }));

  return [...hardeningSteps, ...renumberedPg, ...renumberedHa];
}

export function getLbClusterSteps(): StepDefinition[] {
  const hardeningSteps = getHardeningSteps();
  const pgSteps = getPostgresSteps();

  // Renumber: hardening, PG -- offsets calculated dynamically
  const offset = hardeningSteps.length;
  const renumberedPg = pgSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset,
  }));

  return [...hardeningSteps, ...renumberedPg];
}
