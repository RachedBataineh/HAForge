import { db } from "@HAForge/db";
import { clusters, executions, executionLogs, executionSteps, sshKeys, clusterPatches } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { SSHExecutor } from "./ssh-executor";
import { decryptPrivateKey } from "../routers/shared";
import { initStep, initServer, appendOutput, setServerDone, clearExecution } from "./live-output";
import type { PatchDefinition, PatchStep } from "../patches/types";
import type { TargetRole } from "../templates/cluster-steps";

function getTargetRoles(targetRole: TargetRole, clusterServers: any[]): string[] {
  switch (targetRole) {
    case "all": {
      const roles = clusterServers.map((s: any) => s.role).filter(Boolean);
      return [...new Set(roles)];
    }
    case "all_pg":
      return ["postgresql_1", "postgresql_2", "postgresql_3"];
    case "all_ha":
      return ["haproxy_1", "haproxy_2", "haproxy_3"];
    default:
      return [targetRole];
  }
}

function resolveSteps(patch: PatchDefinition): PatchStep[] {
  if (patch.steps && patch.steps.length > 0) {
    return patch.steps;
  }
  // Simple mode: wrap commands into a single step
  if (patch.commands && patch.targetRole) {
    return [{
      name: patch.name,
      targetRole: patch.targetRole,
      commands: patch.commands,
      files: patch.files,
      validation: patch.validation,
    }];
  }
  throw new Error(`Patch ${patch.id} has no steps or commands`);
}

async function discoverLeader(servers: any[]): Promise<string | null> {
  // SSH into one server and curl each PG node's Patroni REST API
  // Same approach as pgNodeRoles in cluster router: HTTPS on private IP
  // 200 = leader, anything else = replica
  const pgServers = servers.filter((s: any) => s.role?.startsWith("postgresql") && s.ipAddress && s.sshKeyId);
  if (pgServers.length === 0) return null;

  // Find a server to SSH into
  let ssh: SSHExecutor | null = null;
  for (const candidate of pgServers) {
    try {
      const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, candidate.sshKeyId) });
      if (!key?.privateKey) continue;
      ssh = new SSHExecutor({
        host: candidate.ipAddress,
        port: candidate.sshPort || 22,
        username: candidate.sshUser || "root",
        privateKey: decryptPrivateKey(key.privateKey)!,
      });
      await ssh.connect();
      break;
    } catch { continue; }
  }

  if (!ssh) return null;

  try {
    for (const server of pgServers) {
      if (!server.privateIpAddress) continue;
      try {
        const result = await ssh.exec(
          `curl -sk https://${server.privateIpAddress}:8008/leader -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 2>/dev/null || echo '000'`,
        );
        const code = (result.stdout || "").trim();
        if (code === "200") {
          return server.role;
        }
      } catch { continue; }
    }
  } finally {
    await ssh.disconnect();
  }

  return null;
}

export async function runPatch(
  clusterId: string,
  patch: PatchDefinition,
): Promise<string> {
  const cluster = await db.query.clusters.findFirst({
    where: eq(clusters.id, clusterId),
    with: { servers: true },
  });
  if (!cluster) throw new Error("Cluster not found");

  const steps = resolveSteps(patch);

  // Discover leader if needed
  let leaderRole: string | null = null;
  if (patch.discoverLeader) {
    const pgServers = cluster.servers.filter((s: any) => s.role?.startsWith("postgresql"));
    leaderRole = await discoverLeader(pgServers);
    if (!leaderRole) throw new Error("Could not determine cluster leader. Ensure Patroni is running.");
  }

  // Create execution record
  const [execution] = await db.insert(executions).values({
    clusterId,
    status: "running",
    executionType: "patch",
    currentPhase: patch.phase,
    currentStep: "starting",
  }).returning();
  if (!execution) throw new Error("Failed to create execution");

  const executionId = execution.id;

  // Create execution step records
  const stepRecords: any[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const [inserted] = await db.insert(executionSteps).values({
      executionId,
      stepNumber: i + 1,
      phase: patch.phase,
      stepName: step.name,
      targetRole: step.targetRole,
      status: "pending",
      commandTemplate: JSON.stringify(step.commands),
      resolvedCommand: "",
    }).returning();
    if (inserted) stepRecords.push(inserted);
  }

  // Create patch record
  const [patchRecord] = await db.insert(clusterPatches).values({
    clusterId,
    patchId: patch.id,
    status: "applying",
  }).returning();

  // Run in background
  (async () => {
    try {
      await executePatchSteps(executionId, steps, stepRecords, cluster, leaderRole);

      await db.update(executions)
        .set({ status: "completed", completedAt: new Date(), currentStep: "completed" })
        .where(eq(executions.id, executionId));

      if (patchRecord) {
        await db.update(clusterPatches)
          .set({ status: "applied", appliedAt: new Date() })
          .where(eq(clusterPatches.id, patchRecord.id));
      }
    } catch (err: any) {
      await db.update(executions)
        .set({ status: "failed", completedAt: new Date(), currentStep: "failed" })
        .where(eq(executions.id, executionId));

      if (patchRecord) {
        await db.update(clusterPatches)
          .set({ status: "failed" })
          .where(eq(clusterPatches.id, patchRecord.id));
      }
    } finally {
      // Don't clear live output on failure so the user can read the logs
      // Only clear on success
      try {
        const exec = await db.query.executions.findFirst({ where: eq(executions.id, executionId) });
        if (exec?.status === "completed") {
          clearExecution(executionId);
        }
      } catch {
        clearExecution(executionId);
      }
    }
  })();

  return executionId;
}

async function executePatchSteps(
  executionId: string,
  steps: PatchStep[],
  stepRecords: any[],
  cluster: any,
  leaderRole: string | null,
) {
  const serverMap = new Map<string, any>();
  for (const server of cluster.servers) {
    serverMap.set(server.id, server);
  }

  // Resolve SSH keys for all servers upfront
  for (const [, server] of serverMap) {
    if (server.sshKeyId) {
      const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, server.sshKeyId) });
      if (key?.privateKey) {
        server._resolvedPrivateKey = decryptPrivateKey(key.privateKey);
      }
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const stepRecord = stepRecords[i];

    if (!stepRecord) continue;

    // Update execution current step
    await db.update(executions)
      .set({ currentStep: step.name })
      .where(eq(executions.id, executionId));

    // Mark step running
    await db.update(executionSteps)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(executionSteps.id, stepRecord.id));

    initStep(executionId, stepRecord.id, step.name);

    try {
      // Resolve which servers to target
      const targetRoles = getTargetRoles(step.targetRole, cluster.servers);
      const targetServers = cluster.servers.filter((s: any) =>
        targetRoles.includes(s.role),
      );

      // Build environment variables
      const envVars: Record<string, string> = {};
      if (leaderRole) {
        envVars.LEADER_ROLE = leaderRole;
        const leaderServer = cluster.servers.find((s: any) => s.role === leaderRole);
        if (leaderServer) {
          envVars.LEADER_IP = leaderServer.ipAddress || "";
        }
        const replicaRoles = ["postgresql_1", "postgresql_2", "postgresql_3"].filter(r => r !== leaderRole);
        envVars.REPLICA_1_ROLE = replicaRoles[0] || "";
        envVars.REPLICA_2_ROLE = replicaRoles[1] || "";
      }

      // Execute on each target server
      for (const server of targetServers) {
        if (!server.ipAddress || !server._resolvedPrivateKey) {
          initServer(executionId, stepRecord.id, server.id, server.ipAddress || "unknown", server.role);
          setServerDone(executionId, stepRecord.id, server.id, 1);
          appendOutput(executionId, stepRecord.id, server.id, "ERROR: No IP or SSH key\n");
          continue;
        }

        const ssh = new SSHExecutor({
          host: server.ipAddress,
          port: server.sshPort || 22,
          username: server.sshUser || "root",
          privateKey: server._resolvedPrivateKey,
        });

        try {
          await ssh.connect();

          initServer(executionId, stepRecord.id, server.id, server.ipAddress, server.role);

          // Inject env vars for this server
          const envExports = Object.entries(envVars)
            .map(([k, v]) => `export ${k}="${v}"`)
            .join("\n");

          const isCurrentLeader = leaderRole === server.role;
          const roleExports = `export IS_LEADER=${isCurrentLeader ? "1" : "0"}\nexport MY_ROLE=${server.role}`;

          // Upload files
          if (step.files) {
            for (const file of step.files) {
              appendOutput(executionId, stepRecord.id, server.id, `$ Upload ${file.path}\n`);
              await ssh.exec(`sudo tee ${file.path} > /dev/null << 'HAFORGE_PATCH_EOF'\n${file.content}HAFORGE_PATCH_EOF`);
              if (file.permissions) await ssh.exec(`sudo chmod ${file.permissions} ${file.path}`);
              if (file.owner) await ssh.exec(`sudo chown ${file.owner} ${file.path}`);
            }
          }

          // Build and run command script
          const fullScript = [
            "set -e",
            "export DEBIAN_FRONTEND=noninteractive",
            envExports,
            roleExports,
            ...step.commands,
          ].join("\n");

          await db.update(executionSteps)
            .set({ resolvedCommand: fullScript })
            .where(eq(executionSteps.id, stepRecord.id));

          appendOutput(executionId, stepRecord.id, server.id, `$ ${step.commands.join("\n$ ")}\n\n`);

          // Stream output
          const onStdout = (chunk: string) => appendOutput(executionId, stepRecord.id, server.id, chunk);
          const onStderr = (chunk: string) => appendOutput(executionId, stepRecord.id, server.id, chunk);
          ssh.on("stdout", onStdout);
          ssh.on("stderr", onStderr);

          try {
            const result = await ssh.exec(fullScript);
            setServerDone(executionId, stepRecord.id, server.id, result.exitCode);

            await db.insert(executionLogs).values({
              stepId: stepRecord.id,
              serverId: server.id,
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
            });

            if (result.exitCode !== 0 && result.exitCode !== null) {
              if (step.critical !== false) {
                throw new Error(`Failed on ${server.role} (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
              }
            }
          } finally {
            ssh.off("stdout", onStdout);
            ssh.off("stderr", onStderr);
          }
        } finally {
          await ssh.disconnect();
        }
      }

      // Run validation if present
      if (step.validation) {
        const firstTarget = targetServers[0];
        if (firstTarget?._resolvedPrivateKey) {
          const ssh = new SSHExecutor({
            host: firstTarget.ipAddress,
            port: firstTarget.sshPort || 22,
            username: firstTarget.sshUser || "root",
            privateKey: firstTarget._resolvedPrivateKey,
          });
          await ssh.connect();
          try {
            const vResult = await ssh.exec(step.validation);
            if (vResult.exitCode !== 0 && vResult.exitCode !== null) {
              throw new Error(`Validation failed: ${vResult.stderr || vResult.stdout}`);
            }
          } finally {
            await ssh.disconnect();
          }
        }
      }

      // Mark step completed
      await db.update(executionSteps)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(executionSteps.id, stepRecord.id));

    } catch (err: any) {
      await db.update(executionSteps)
        .set({ status: "failed", completedAt: new Date(), errorMessage: err.message })
        .where(eq(executionSteps.id, stepRecord.id));

      if (step.critical !== false) {
        throw err;
      }
    }
  }
}
