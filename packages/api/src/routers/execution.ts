import { db } from "@HAForge/db";
import { clusters, executions, executionLogs, executionSteps } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { Orchestrator } from "../services/orchestrator";
import { getLiveOutput } from "../services/live-output";

// Track active orchestrators in memory
const activeOrchestrators = new Map<string, Orchestrator>();

async function verifyExecutionOwnership(executionId: string, userId: string) {
  const execution = await db.query.executions.findFirst({
    where: eq(executions.id, executionId),
  });
  if (!execution) throw new Error("Execution not found");
  const cluster = await db.query.clusters.findFirst({
    where: eq(clusters.id, execution.clusterId),
  });
  if (cluster && cluster.userId !== userId) throw new Error("Access denied");
  return execution;
}

async function verifyClusterOwnership(clusterId: string, userId: string) {
  const cluster = await db.query.clusters.findFirst({
    where: eq(clusters.id, clusterId),
  });
  if (!cluster) throw new Error("Cluster not found");
  if (cluster.userId !== userId) throw new Error("Access denied");
  return cluster;
}

export const executionRouter = router({
  start: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await verifyClusterOwnership(input.clusterId, ctx.session.user.id);
      const orchestrator = new Orchestrator(input.clusterId);
      const executionId = await orchestrator.start();
      activeOrchestrators.set(executionId, orchestrator);
      return { executionId };
    }),

  retryStep: protectedProcedure
    .input(
      z.object({
        executionId: z.string(),
        stepId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const execution = await verifyExecutionOwnership(input.executionId, ctx.session.user.id);
      const orchestrator = new Orchestrator(execution.clusterId);
      const newExecutionId = await orchestrator.start();
      activeOrchestrators.set(newExecutionId, orchestrator);
      return { executionId: newExecutionId };
    }),

  getProgress: protectedProcedure
    .input(z.object({ executionId: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyExecutionOwnership(input.executionId, ctx.session.user.id);
      const execution = await db.query.executions.findFirst({
        where: eq(executions.id, input.executionId),
        with: {
          steps: {
            orderBy: (steps, { asc }) => [asc(steps.stepNumber)],
          },
        },
      });
      return execution;
    }),

  getLogs: protectedProcedure
    .input(
      z.object({
        stepId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const step = await db.query.executionSteps.findFirst({
        where: eq(executionSteps.id, input.stepId),
      });
      if (!step) throw new Error("Step not found");
      await verifyExecutionOwnership(step.executionId, ctx.session.user.id);
      const logs = await db.query.executionLogs.findMany({
        where: eq(executionLogs.stepId, input.stepId),
      });
      return logs;
    }),

  cancel: protectedProcedure
    .input(z.object({ executionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await verifyExecutionOwnership(input.executionId, ctx.session.user.id);
      const orchestrator = activeOrchestrators.get(input.executionId);
      if (orchestrator) {
        await orchestrator.cancel();
        activeOrchestrators.delete(input.executionId);
      }
      // Update execution status in DB
      await db
        .update(executions)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(eq(executions.id, input.executionId));
      return { success: true };
    }),

  getLiveOutput: protectedProcedure
    .input(z.object({ executionId: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyExecutionOwnership(input.executionId, ctx.session.user.id);
      return getLiveOutput(input.executionId);
    }),
});
