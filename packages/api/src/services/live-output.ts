// In-memory live output store for real-time terminal streaming

export interface ServerOutput {
  serverId: string;
  serverIp: string;
  role: string;
  output: string;
  exitCode: number | null;
  isRunning: boolean;
}

interface StepData {
  stepId: string;
  stepName: string;
  servers: Map<string, ServerOutput>;
}

// executionId -> stepId -> StepData
const store = new Map<string, Map<string, StepData>>();

export function initStep(executionId: string, stepId: string, stepName: string) {
  if (!store.has(executionId)) {
    store.set(executionId, new Map());
  }
  store.get(executionId)!.set(stepId, {
    stepId,
    stepName,
    servers: new Map(),
  });
}

export function initServer(executionId: string, stepId: string, serverId: string, serverIp: string, role: string) {
  const execution = store.get(executionId);
  const step = execution?.get(stepId);
  if (!step) return;

  step.servers.set(serverId, {
    serverId,
    serverIp,
    role,
    output: "",
    exitCode: null,
    isRunning: true,
  });
}

export function appendOutput(executionId: string, stepId: string, serverId: string, data: string) {
  const step = store.get(executionId)?.get(stepId);
  const server = step?.servers.get(serverId);
  if (!server) return;
  server.output += data;
}

export function setServerDone(executionId: string, stepId: string, serverId: string, exitCode: number | null) {
  const step = store.get(executionId)?.get(stepId);
  const server = step?.servers.get(serverId);
  if (!server) return;
  server.exitCode = exitCode;
  server.isRunning = false;
}

export function getLiveOutput(executionId: string) {
  const execution = store.get(executionId);
  if (!execution) return { steps: [] as any[] };

  const steps: any[] = [];

  for (const [, step] of execution) {
    const servers: any[] = [];
    for (const [, server] of step.servers) {
      servers.push({
        serverId: server.serverId,
        serverIp: server.serverIp,
        role: server.role,
        output: server.output,
        exitCode: server.exitCode,
        isRunning: server.isRunning,
      });
    }
    steps.push({ stepId: step.stepId, stepName: step.stepName, servers });
  }

  return { steps };
}

export function clearExecution(executionId: string) {
  store.delete(executionId);
}
