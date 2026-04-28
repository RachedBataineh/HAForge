import type { StepDefinition } from "./types";
import { getPostgresSteps } from "./postgres/postgres-steps";
import { getHaproxySteps } from "./haproxy/haproxy-steps";
import { getHardeningSteps } from "./hardening/hardening-steps";
import { getMonitoringSteps } from "./monitoring/node-exporter-steps";
import { getPgExporterSteps } from "./monitoring/pg-exporter-steps";

export type { TargetRole, StepDefinition, CommandStep, FileStep } from "./types";

export function getClusterSteps(enableMonitoring = true, pgUsername = "postgres", pgPassword = ""): StepDefinition[] {
  const hardeningSteps = getHardeningSteps();
  const pgSteps = getPostgresSteps();
  const haSteps = getHaproxySteps();
  const nodeExporterSteps = enableMonitoring ? getMonitoringSteps() : [];
  const pgExporterSteps = enableMonitoring ? getPgExporterSteps(pgUsername, pgPassword) : [];

  const offset1 = hardeningSteps.length;
  const offset2 = offset1 + pgSteps.length;
  const offset3 = offset2 + haSteps.length;
  const offset4 = offset3 + nodeExporterSteps.length;

  const renumberedPg = pgSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset1,
  }));
  const renumberedHa = haSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset2,
  }));
  const renumberedNodeExporter = nodeExporterSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset3,
  }));
  const renumberedPgExporter = pgExporterSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset4,
  }));

  return [...hardeningSteps, ...renumberedPg, ...renumberedHa, ...renumberedNodeExporter, ...renumberedPgExporter];
}

export function getLbClusterSteps(enableMonitoring = true, pgUsername = "postgres", pgPassword = ""): StepDefinition[] {
  const hardeningSteps = getHardeningSteps();
  const pgSteps = getPostgresSteps();
  const nodeExporterSteps = enableMonitoring ? getMonitoringSteps() : [];
  const pgExporterSteps = enableMonitoring ? getPgExporterSteps(pgUsername, pgPassword) : [];

  const offset1 = hardeningSteps.length;
  const offset2 = offset1 + pgSteps.length;
  const offset3 = offset2 + nodeExporterSteps.length;

  const renumberedPg = pgSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset1,
  }));
  const renumberedNodeExporter = nodeExporterSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset2,
  }));
  const renumberedPgExporter = pgExporterSteps.map((step) => ({
    ...step,
    stepNumber: step.stepNumber + offset3,
  }));

  return [...hardeningSteps, ...renumberedPg, ...renumberedNodeExporter, ...renumberedPgExporter];
}
