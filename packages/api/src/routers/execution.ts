import { db } from "@HAForge/db";
import { executions, executionLogs } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { Orchestrator } from "../services/orchestrator";

// Track active orchestrators in memory
const activeOrchestrators = new Map<string, Orchestrator>();

export const executionRouter = router({
  start: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
      // For retry, we restart the entire execution from scratch
      // A more sophisticated approach would track which step failed and restart from there
      const execution = await db.query.executions.findFirst({
        where: eq(executions.id, input.executionId),
      });
      if (!execution) throw new Error("Execution not found");

      const orchestrator = new Orchestrator(execution.clusterId);
      const newExecutionId = await orchestrator.start();
      activeOrchestrators.set(newExecutionId, orchestrator);
      return { executionId: newExecutionId };
    }),

  getProgress: protectedProcedure
    .input(z.object({ executionId: z.string() }))
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
      const logs = await db.query.executionLogs.findMany({
        where: eq(executionLogs.stepId, input.stepId),
      });
      return logs;
    }),

  cancel: protectedProcedure
    .input(z.object({ executionId: z.string() }))
    .mutation(async ({ input }) => {
      const orchestrator = activeOrchestrators.get(input.executionId);
      if (orchestrator) {
        await orchestrator.cancel();
        activeOrchestrators.delete(input.executionId);
      }
      return { success: true };
    }),
});
