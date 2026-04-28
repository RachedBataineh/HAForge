import type { StepDefinition } from "./types";
import { getPostgresSteps } from "./postgres/postgres-steps";
import { getHaproxySteps } from "./haproxy/haproxy-steps";
import { getHardeningSteps } from "./hardening/hardening-steps";
import { getMonitoringSteps } from "./monitoring/node-exporter-steps";

export type { TargetRole, StepDefinition, CommandStep, FileStep } from "./types";

export function getClusterSteps(enableMonitoring = true): StepDefinition[] {
  const hardeningSteps = getHardeningSteps();
  const pgSteps = getPostgresSteps();
  const haSteps = getHaproxySteps();
  const monitoringSteps = enableMonitoring ? getMonitoringSteps() : [];

  const offset1 = hardeningSteps.length;
  const offset2 = offset1 + pgSteps.length;
  const offset3 = offset2 + haSteps.length;

  const renumberedPg = pgSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset1,
  }));
  const renumberedHa = haSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset2,
  }));
  const renumberedMonitoring = monitoringSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset3,
  }));

  return [...hardeningSteps, ...renumberedPg, ...renumberedHa, ...renumberedMonitoring];
}

export function getLbClusterSteps(enableMonitoring = true): StepDefinition[] {
  const hardeningSteps = getHardeningSteps();
  const pgSteps = getPostgresSteps();
  const monitoringSteps = enableMonitoring ? getMonitoringSteps() : [];

  const offset1 = hardeningSteps.length;
  const offset2 = offset1 + pgSteps.length;

  const renumberedPg = pgSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset1,
  }));
  const renumberedMonitoring = monitoringSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset2,
  }));

  return [...hardeningSteps, ...renumberedPg, ...renumberedMonitoring];
}
