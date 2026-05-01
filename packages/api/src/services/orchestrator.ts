import { db, clusters, executions, executionSteps, executionLogs, servers, sshKeys, user } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { SSHExecutor } from "./ssh-executor";
import { generateClusterCertificates, type GeneratedCerts } from "./cert-generator";
import { resolveVariables, type VariableMap } from "./variable-resolver";
import { getClusterSteps, getLbClusterSteps, type StepDefinition, type TargetRole } from "../templates/cluster-steps";
import { encrypt, decrypt, isEncrypted } from "../services/crypto";
import { decryptPrivateKey } from "../routers/shared";
import { getHardeningSteps } from "../templates/hardening/hardening-steps";
import { generatePassword, SERVER_INFO_SCRIPT, parseServerInfo } from "./server-info";
import { EventEmitter } from "events";
import {
  initStep,
  initServer,
  appendOutput,
  setServerDone,
  clearExecution,
} from "./live-output";

export interface OrchestratorEvents {
  stepStarted: (step: typeof executionSteps.$inferSelect) => void;
  stepCompleted: (step: typeof executionSteps.$inferSelect) => void;
  stepFailed: (step: typeof executionSteps.$inferSelect, error: string) => void;
  log: (data: { stepId: string; serverId: string; stdout?: string; stderr?: string; exitCode?: number }) => void;
  completed: (executionId: string) => void;
  failed: (executionId: string, error: string) => void;
}

function getTargetServerRoles(targetRole: TargetRole, serverMap?: Map<string, any>): string[] {
  switch (targetRole) {
    case "all":
      // Dynamic: target all servers that exist in the cluster
      if (serverMap) {
        const roles = Array.from(serverMap.values()).map((s: any) => s.role).filter(Boolean);
        return [...new Set(roles)];
      }
      return ["postgresql_1", "postgresql_2", "postgresql_3", "haproxy_1", "haproxy_2", "haproxy_3"];
    case "all_pg":
      return ["postgresql_1", "postgresql_2", "postgresql_3"];
    case "all_ha":
      return ["haproxy_1", "haproxy_2", "haproxy_3"];
    default:
      return [targetRole];
  }
}

export class Orchestrator extends EventEmitter {
  private clusterId: string;
  private executionId: string | null = null;
  private sshConnections: Map<string, SSHExecutor> = new Map();
  private cancelled = false;

  constructor(clusterId: string) {
    super();
    this.clusterId = clusterId;
  }

  async start(): Promise<string> {
    // Fetch cluster with servers
    const cluster = await db.query.clusters.findFirst({
      where: eq(clusters.id, this.clusterId),
      with: { servers: true },
    });

    if (!cluster) throw new Error("Cluster not found");
    const isLb = cluster.clusterType === "hetzner_lb";
    const minServers = isLb ? 3 : 6;
    if (!cluster.servers || cluster.servers.length < minServers) {
      throw new Error(isLb
        ? "Cluster must have 3 PostgreSQL servers for Hetzner LB mode"
        : "Cluster must have 6 servers (3 PostgreSQL + 3 HAProxy)");
    }

    // Auto-generate passwords if not set (encrypt before storing)
    if (!cluster.superuserPassword || !cluster.replicationPassword) {
      const generatedSuperuser = cluster.superuserPassword || generatePassword();
      const generatedReplication = cluster.replicationPassword || generatePassword();
      await db
        .update(clusters)
        .set({
          superuserPassword: encrypt(generatedSuperuser),
          replicationPassword: encrypt(generatedReplication),
          status: "deploying",
        })
        .where(eq(clusters.id, this.clusterId));

      // Use the plaintext values for orchestration
      cluster.superuserPassword = generatedSuperuser;
      cluster.replicationPassword = generatedReplication;
    } else {
      // Decrypt existing passwords for use
      const sp = cluster.superuserPassword;
      const rp = cluster.replicationPassword;
      cluster.superuserPassword = isEncrypted(sp) ? decrypt(sp) : sp;
      cluster.replicationPassword = isEncrypted(rp) ? decrypt(rp) : rp;
      await db
        .update(clusters)
        .set({ status: "deploying" })
        .where(eq(clusters.id, this.clusterId));
    }

    // Create execution record
    const inserted = await db
      .insert(executions)
      .values({ clusterId: this.clusterId, status: "running" })
      .returning();

    if (!inserted[0]) throw new Error("Failed to create execution record");
    this.executionId = inserted[0].id;

    // Build variable map
    const serverMap = this.buildServerMap(cluster.servers);
    const vars = await this.buildVariableMap(cluster, serverMap);

    // Create step records
    const steps = isLb ? getLbClusterSteps(!!cluster.enableMonitoring) : getClusterSteps(!!cluster.enableMonitoring);
    const stepRecords: (typeof executionSteps.$inferSelect)[] = [];

    for (const step of steps) {
      const inserted = await db
        .insert(executionSteps)
        .values({
          executionId: this.executionId,
          stepNumber: step.stepNumber,
          phase: step.phase,
          stepName: step.name,
          targetRole: step.targetRole,
          status: "pending",
          commandTemplate: JSON.stringify(step.commands),
          resolvedCommand: "",
        })
        .returning();
      if (inserted[0]) stepRecords.push(inserted[0]);
    }

    // Run orchestration in background (catch to avoid unhandled rejection)
    this.run(serverMap, vars, stepRecords, isLb, cluster).catch((err) => {
      console.error("Orchestrator failed:", err);
    });

    return this.executionId!;
  }

  private async run(
    serverMap: Map<string, any>,
    vars: VariableMap,
    stepRecords: (typeof executionSteps.$inferSelect)[],
    isLb: boolean,
    cluster: any,
  ) {
    const hardeningStepCount = getHardeningSteps().length;
    const adminUsername = vars.ADMIN_USERNAME;

    try {
      // Phase 0: Connect to all servers as root
      await this.connectAllServers(serverMap);

      // Phase 0.5: Generate and upload certificates
      const certs = generateClusterCertificates(
        [vars.IP_ADDRESS_NODE_1, vars.IP_ADDRESS_NODE_2, vars.IP_ADDRESS_NODE_3],
        [vars.PRIVATE_IP_NODE_1, vars.PRIVATE_IP_NODE_2, vars.PRIVATE_IP_NODE_3],
      );
      await this.uploadCertificates(certs, serverMap);

      // Execute steps
      for (const stepRecord of stepRecords) {
        if (this.cancelled) { await this.markExecutionFailed("Cancelled by user"); return; }

        const steps = isLb ? getLbClusterSteps(!!cluster.enableMonitoring) : getClusterSteps(!!cluster.enableMonitoring);
        const stepDef = steps.find((s) => s.stepNumber === stepRecord.stepNumber);
        if (!stepDef) continue;

        // After hardening steps: disconnect root, reconnect as admin user
        if (stepRecord.stepNumber === hardeningStepCount + 1) {
          await this.disconnectAll();
          for (const [, server] of serverMap) {
            server.sshUser = adminUsername;
          }
          await this.connectAllServers(serverMap);
        }

        await this.executeStep(stepRecord, stepDef, serverMap, vars);
      }

      // Configure Hetzner Load Balancer if LB mode
      if (isLb && cluster.loadBalancerId) {
        // Remove TLS from Patroni REST API (Hetzner LB health checks don't accept self-signed certs)
        const pgServers2 = Array.from(serverMap.values()).filter((s: any) =>
          s.role?.startsWith("postgresql"),
        );
        await Promise.all(
          pgServers2.map(async (server: any) => {
            const ssh = this.sshConnections.get(server.id);
            if (ssh) {
              await ssh.exec("sudo sed -i '/certfile:.*server\\.crt/d;/keyfile:.*server\\.key/d' /etc/patroni/config.yml && sudo systemctl restart patroni");
            }
          }),
        );
        // Wait for Patroni to restart
        await new Promise((resolve) => setTimeout(resolve, 15000));

        await this.configureHetznerLoadBalancer(cluster, vars);
      }

      // Cache server info after successful deployment
      await this.cacheServerInfo();

      // Update server records: sshUser is now the admin user
      for (const server of Array.from(serverMap.values())) {
        await db.update(servers).set({ sshUser: adminUsername }).where(eq(servers.id, server.id));
      }

      // Mark execution completed
      await db
        .update(executions)
        .set({ status: "completed", completedAt: new Date(), currentPhase: "done", currentStep: "completed" })
        .where(eq(executions.id, this.executionId!));

      await db
        .update(clusters)
        .set({ status: "running" })
        .where(eq(clusters.id, this.clusterId));

      this.emit("completed", this.executionId);
      clearExecution(this.executionId!);
    } catch (err: any) {
      await this.markExecutionFailed(err.message);
      this.emit("failed", this.executionId!, err.message);
    } finally {
      await this.disconnectAll();
    }
  }

  private async executeStep(
    stepRecord: typeof executionSteps.$inferSelect,
    stepDef: StepDefinition,
    serverMap: Map<string, any>,
    vars: VariableMap,
  ) {
    // Mark step running
    await db
      .update(executionSteps)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(executionSteps.id, stepRecord.id));

    await db
      .update(executions)
      .set({ currentPhase: stepDef.phase, currentStep: stepDef.name })
      .where(eq(executions.id, this.executionId!));

    this.emit("stepStarted", stepRecord);

    // Initialize live output for this step
    initStep(this.executionId!, stepRecord.id, stepDef.name);

    try {
      const targetRoles = getTargetServerRoles(stepDef.targetRole as TargetRole, serverMap);
      const targetServers = Array.from(serverMap.values()).filter((s) =>
        targetRoles.includes(s.role),
      );

      // Upload files first
      for (const file of stepDef.files) {
        const resolvedContent = resolveVariables(file.content, vars);

        for (const server of targetServers) {
          const ssh = this.sshConnections.get(server.id);
          if (!ssh) continue;

          // Write file content via temp file + sudo mv (to handle root-owned paths)
          const tmpPath = `/tmp/haforge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await ssh.uploadFile(resolvedContent, tmpPath);
          await ssh.exec(`sudo mkdir -p $(dirname '${file.path}') && sudo mv ${tmpPath} '${file.path}'`);

          if (file.owner) {
            await ssh.exec(`sudo chown ${file.owner} '${file.path}'`);
          }
          if (file.permissions) {
            await ssh.exec(`sudo chmod ${file.permissions} '${file.path}'`);
          }
        }
      }

      // Execute commands - join all commands into a single script so env vars persist
      for (const cmdGroup of stepDef.commands) {
        const resolvedCommands = cmdGroup.commands.map((cmd) => resolveVariables(cmd, vars));
        const fullScript = [
          "set -e",
          "export DEBIAN_FRONTEND=noninteractive",
          ...resolvedCommands,
        ].join("\n");

        // Save resolved commands to DB so the UI can show them
        await db
          .update(executionSteps)
          .set({ resolvedCommand: fullScript })
          .where(eq(executionSteps.id, stepRecord.id));

        const results = await Promise.allSettled(
          targetServers.map(async (server) => {
            const ssh = this.sshConnections.get(server.id);
            if (!ssh) throw new Error(`No SSH connection for server ${server.id}`);

            // Initialize live output for this server
            initServer(this.executionId!, stepRecord.id, server.id, server.ipAddress, server.role);

            // Push the commands into the live terminal so the user can see what's being run
            appendOutput(
              this.executionId!,
              stepRecord.id,
              server.id,
              `$ ${resolvedCommands.join("\n$ ")}\n\n`,
            );

            // Listen to live output events
            const onStdout = (chunk: string) => {
              appendOutput(this.executionId!, stepRecord.id, server.id, chunk);
            };
            const onStderr = (chunk: string) => {
              appendOutput(this.executionId!, stepRecord.id, server.id, chunk);
            };
            ssh.on("stdout", onStdout);
            ssh.on("stderr", onStderr);

            try {
              const result = await ssh.exec(fullScript);

              // Mark server done in live output
              setServerDone(this.executionId!, stepRecord.id, server.id, result.exitCode);

              // Log output to DB
              await db.insert(executionLogs).values({
                stepId: stepRecord.id,
                serverId: server.id,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
              });

              this.emit("log", {
                stepId: stepRecord.id,
                serverId: server.id,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode ?? undefined,
              });

              if (result.exitCode !== 0 && result.exitCode !== null) {
                throw new Error(
                  `Commands failed on ${server.ipAddress} (exit ${result.exitCode})\n${result.stderr}\n${result.stdout}`,
                );
              }
            } finally {
              ssh.off("stdout", onStdout);
              ssh.off("stderr", onStderr);
            }
          }),
        );

        // Check for failures
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          const errorMsg = failures
            .map((f) => (f as PromiseRejectedResult).reason)
            .join("\n");
          throw new Error(errorMsg);
        }
      }

      // Run validation if present
      if (stepDef.validation) {
        const resolvedValidation = resolveVariables(stepDef.validation, vars);
        // Run on first target server
        const firstServer = targetServers[0];
        const ssh = this.sshConnections.get(firstServer.id);
        if (ssh) {
          await ssh.exec(resolvedValidation);
        }
      }

      // Mark step completed
      await db
        .update(executionSteps)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(executionSteps.id, stepRecord.id));

      this.emit("stepCompleted", stepRecord);
    } catch (error: any) {
      await db
        .update(executionSteps)
        .set({ status: "failed", completedAt: new Date(), errorMessage: error.message })
        .where(eq(executionSteps.id, stepRecord.id));

      this.emit("stepFailed", stepRecord, error.message);
      throw error;
    }
  }

  private async connectAllServers(serverMap: Map<string, any>) {
    // Resolve SSH private keys from ssh_keys table via sshKeyId
    for (const [, server] of serverMap) {
      if (server.sshKeyId) {
        const key = await db.query.sshKeys.findFirst({
          where: eq(sshKeys.id, server.sshKeyId),
        });
        if (key?.privateKey) {
          server.resolvedPrivateKey = decryptPrivateKey(key.privateKey);
        }
      }
      if (!server.resolvedPrivateKey) {
        throw new Error(`No SSH private key found for server ${server.ipAddress || server.hetznerServerId}`);
      }
    }

    const results = await Promise.allSettled(
      Array.from(serverMap.values()).map(async (server) => {
        const ssh = new SSHExecutor({
          host: server.ipAddress,
          port: server.sshPort,
          username: server.sshUser,
          privateKey: server.resolvedPrivateKey,
        });
        await ssh.connect();
        this.sshConnections.set(server.id, ssh);
      }),
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const msgs = failures
        .map((f) => (f as PromiseRejectedResult).reason?.message || "Unknown error")
        .join("; ");
      throw new Error(`SSH connection failed for ${failures.length} server(s): ${msgs}`);
    }
  }

  private async uploadCertificates(certs: GeneratedCerts, serverMap: Map<string, any>) {
    const pgServers = ["postgresql_1", "postgresql_2", "postgresql_3"].map((role) =>
      Array.from(serverMap.values()).find((s) => s.role === role),
    ).filter(Boolean);

    for (let i = 0; i < pgServers.length; i++) {
      const server = pgServers[i];
      const ssh = this.sshConnections.get(server.id);
      if (!ssh) continue;

      const nodeKey = `node${i + 1}` as keyof typeof certs.etcdNodes;

      // Stop etcd before re-uploading certs, create directories
      await ssh.exec("sudo systemctl stop etcd 2>/dev/null || true");
      await ssh.exec("sudo mkdir -p /etc/etcd/ssl /var/lib/postgresql/ssl");

      // Upload CA cert
      await ssh.uploadFile(certs.ca.cert, `/tmp/ca.crt`);
      await ssh.exec("sudo mv /tmp/ca.crt /etc/etcd/ssl/ca.crt");

      // Upload etcd node cert
      await ssh.uploadFile(certs.etcdNodes[nodeKey].cert, `/tmp/etcd-node${i + 1}.crt`);
      await ssh.exec(`sudo mv /tmp/etcd-node${i + 1}.crt /etc/etcd/ssl/`);

      // Upload etcd node key
      await ssh.uploadFile(certs.etcdNodes[nodeKey].key, `/tmp/etcd-node${i + 1}.key`);
      await ssh.exec(`sudo mv /tmp/etcd-node${i + 1}.key /etc/etcd/ssl/`);

      // Fix ownership immediately
      await ssh.exec("sudo chown -R etcd:etcd /etc/etcd/ssl/");
      await ssh.exec("sudo chmod 600 /etc/etcd/ssl/etcd-node*.key");
      await ssh.exec("sudo chmod 644 /etc/etcd/ssl/etcd-node*.crt /etc/etcd/ssl/ca.crt");

      // Upload PostgreSQL server cert
      await ssh.uploadFile(certs.postgresServer.cert, "/tmp/server.crt");
      await ssh.exec("sudo mv /tmp/server.crt /var/lib/postgresql/ssl/");

      await ssh.uploadFile(certs.postgresServer.key, "/tmp/server.key");
      await ssh.exec("sudo mv /tmp/server.key /var/lib/postgresql/ssl/");

      await ssh.uploadFile(certs.postgresServer.req, "/tmp/server.req");
      await ssh.exec("sudo mv /tmp/server.req /var/lib/postgresql/ssl/");

      await ssh.exec("sudo chown postgres:postgres /var/lib/postgresql/ssl/server.*");
    }

    // Upload CA cert to HAProxy servers for backend SSL verification
    const haServers = Array.from(serverMap.values()).filter((s: any) =>
      s.role?.startsWith("haproxy"),
    );
    for (const server of haServers) {
      const ssh = this.sshConnections.get(server.id);
      if (!ssh) continue;

      await ssh.exec("sudo mkdir -p /etc/haproxy");
      await ssh.uploadFile(certs.ca.cert, "/tmp/ca.crt");
      await ssh.exec("sudo mv /tmp/ca.crt /etc/haproxy/ca.crt");
      await ssh.exec("sudo chmod 644 /etc/haproxy/ca.crt");
    }
  }

  private async configureHetznerLoadBalancer(cluster: any, vars: VariableMap) {
    const lbId = cluster.loadBalancerId;
    const token = vars.HETZNER_API_TOKEN;

    if (!lbId || !token) {
      throw new Error("Load Balancer ID and Hetzner API token are required for LB mode");
    }

    // Get PG server Hetzner IDs from servers table
    const clusterData = await db.query.clusters.findFirst({
      where: eq(clusters.id, this.clusterId),
      with: { servers: true },
    });

    const pgServers = (clusterData?.servers || []).filter((s: any) =>
      s.role?.startsWith("postgresql"),
    );

    // Add PG servers as targets to the LB
    for (const server of pgServers) {
      const hetznerServerId = server.hetznerServerId;
      if (!hetznerServerId) continue;

      await fetch(
        `https://api.hetzner.cloud/v1/load_balancers/${lbId}/actions/add_target`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "server",
            server: { id: Number(hetznerServerId) },
            use_private_ip: true,
          }),
        },
      );
    }

    // Add TCP service on port 5432 with Patroni health check (ignore if already exists)
    try {
      await fetch(
        `https://api.hetzner.cloud/v1/load_balancers/${lbId}/actions/add_service`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            protocol: "tcp",
            listen_port: 5432,
            destination_port: 5432,
            proxyprotocol: false,
            health_check: {
              protocol: "http",
              port: 8008,
              interval: 5,
              timeout: 3,
              retries: 3,
              http: {
                domain: "",
                path: "/leader",
                statuses: [200],
                tls: true,
              },
            },
          }),
        },
      );
    } catch (err) {
      console.error("Failed to add service to LB (may already exist):", err);
    }
  }

  private async cacheServerInfo() {
    const allServers = Array.from(this.sshConnections.keys());
    for (const serverId of allServers) {
      const ssh = this.sshConnections.get(serverId);
      if (!ssh) continue;
      try {
        const result = await ssh.exec(SERVER_INFO_SCRIPT);
        if (result.exitCode !== 0) continue;
        const info = parseServerInfo(result.stdout);

        await db.update(servers).set({
          cachedHostname: info.hostname,
          cachedOs: info.os,
          cachedArch: info.arch,
          cachedCpuCores: Number(info.cpuCores) || null,
          cachedRamMB: Number(info.ramMB) || null,
          cachedKernel: info.kernel,
          cachedUptime: info.uptime,
          cachedTimezone: info.timezone,
          cachedDiskTotal: info.diskTotal || null,
          cachedDiskUsed: info.diskUsed || null,
          cachedDiskFree: info.diskFree || null,
          cachedDiskPercent: info.diskPercent || null,
          lastFetchedAt: new Date(),
        }).where(eq(servers.id, serverId));
      } catch (err) {
        console.error(`Failed to cache info for server ${serverId}:`, err);
      }
    }
  }

  private buildServerMap(serversList: any[]): Map<string, any> {
    const map = new Map<string, any>();
    for (const server of serversList) {
      map.set(server.id, server);
    }
    return map;
  }

  private async buildVariableMap(cluster: any, serverMap: Map<string, any>): Promise<VariableMap> {
    const getServerByRole = (role: string) =>
      Array.from(serverMap.values()).find((s: any) => s.role === role);

    const pg1 = getServerByRole("postgresql_1");
    const pg2 = getServerByRole("postgresql_2");
    const pg3 = getServerByRole("postgresql_3");
    const ha1 = getServerByRole("haproxy_1");
    const ha2 = getServerByRole("haproxy_2");
    const ha3 = getServerByRole("haproxy_3");

    // Resolve Hetzner API token from user profile (decrypt from DB)
    const clusterOwner = await db.query.user.findFirst({
      where: eq(user.id, cluster.userId),
    });
    const hetznerToken = clusterOwner?.hetznerApiToken
      ? (() => { try { return decrypt(clusterOwner.hetznerApiToken); } catch { return clusterOwner.hetznerApiToken; } })()
      : "";

    return {
      IP_ADDRESS_NODE_1: pg1?.ipAddress || "",
      IP_ADDRESS_NODE_2: pg2?.ipAddress || "",
      IP_ADDRESS_NODE_3: pg3?.ipAddress || "",
      IP_ADDRESS_NODE_1_POSTGRESQL: pg1?.ipAddress || "",
      IP_ADDRESS_NODE_2_POSTGRESQL: pg2?.ipAddress || "",
      IP_ADDRESS_NODE_3_POSTGRESQL: pg3?.ipAddress || "",
      PRIVATE_IP_NODE_1: pg1?.privateIpAddress || "",
      PRIVATE_IP_NODE_2: pg2?.privateIpAddress || "",
      PRIVATE_IP_NODE_3: pg3?.privateIpAddress || "",
      IP_ADDRESS_HAPROXY_1: ha1?.ipAddress || "",
      IP_ADDRESS_HAPROXY_2: ha2?.ipAddress || "",
      IP_ADDRESS_HAPROXY_3: ha3?.ipAddress || "",
      PRIVATE_IP_HAPROXY_1: ha1?.privateIpAddress || "",
      PRIVATE_IP_HAPROXY_2: ha2?.privateIpAddress || "",
      PRIVATE_IP_HAPROXY_3: ha3?.privateIpAddress || "",
      FLOATING_IP: cluster.floatingIp || "",
      HETZNER_API_TOKEN: hetznerToken,
      FLOATING_IP_ID: cluster.floatingIpId || "",
      LOAD_BALANCER_ID: cluster.loadBalancerId || "",
      SERVER_ID_1: ha1?.hetznerServerId || pg1?.hetznerServerId || "",
      SERVER_ID_2: ha2?.hetznerServerId || pg2?.hetznerServerId || "",
      SERVER_ID_3: ha3?.hetznerServerId || pg3?.hetznerServerId || "",
      SUPERUSER_PASSWORD: cluster.superuserPassword || "",
      SUPERUSER_USERNAME: cluster.superuserUsername || "postgres",
      REPLICATION_PASSWORD: cluster.replicationPassword || "",
      ADMIN_USERNAME: cluster.adminUsername || "haforge",
      VRRP_AUTH_PASS: (cluster.replicationPassword || "haforge").substring(0, 8),
    };
  }

  private async markExecutionFailed(_error: string) {
    if (this.executionId) {
      await db
        .update(executions)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(executions.id, this.executionId));

      await db
        .update(clusters)
        .set({ status: "error" })
        .where(eq(clusters.id, this.clusterId));
    }
  }

  private async disconnectAll() {
    for (const ssh of this.sshConnections.values()) {
      await ssh.disconnect();
    }
    this.sshConnections.clear();
  }

  async cancel() {
    this.cancelled = true;
    await this.disconnectAll();
  }
}
