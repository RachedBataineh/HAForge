import { db } from "@HAForge/db";
import { clusterBackups, backupHistory, clusters, sshKeys } from "@HAForge/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { backupScriptContent, installAwsCliV2Script } from "../templates/backup/backup-script";
import { getUserS3Config } from "./settings";
import crypto from "crypto";

async function getClusterLeaderSsh(clusterId: string, userId: string) {
  const cluster = await db.query.clusters.findFirst({
    where: and(eq(clusters.id, clusterId), eq(clusters.userId, userId)),
    with: { servers: true },
  });
  if (!cluster) throw new Error("Cluster not found or access denied");

  const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
  const { SSHExecutor } = await import("../services/ssh-executor");

  for (const s of pgServers) {
    if (!s.ipAddress || !s.sshKeyId) continue;
    const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, s.sshKeyId) });
    if (!key?.privateKey) continue;
    try {
      const ssh = new SSHExecutor({ host: s.ipAddress, port: s.sshPort || 22, username: s.sshUser || "root", privateKey: key.privateKey });
      await ssh.connect();

      // Use Patroni REST API to check leader status (more reliable than patronictl)
      // curl -k https://127.0.0.1:8008/leader returns 200 only on the leader
      const leaderCheck = await ssh.exec("curl -sk https://127.0.0.1:8008/leader -o /dev/null -w '%{http_code}' 2>/dev/null || echo '000'");
      const httpCode = leaderCheck.stdout?.trim() || "000";
      console.log(`[backup] REST API leader check on ${s.role} (${s.privateIpAddress}): HTTP ${httpCode}`);

      if (httpCode === "200") {
        console.log(`[backup] Found leader: ${s.role} (${s.ipAddress})`);
        return { ssh, server: s, cluster };
      }

      await ssh.disconnect();
    } catch (e) {
      console.log(`[backup] SSH to ${s.role} failed:`, e);
      continue;
    }
  }

  const first = pgServers.find((s) => s.ipAddress && s.sshKeyId);
  if (!first) throw new Error("No accessible PG server found");
  console.log(`[backup] WARNING: leader detection failed, falling back to ${first.role} (${first.ipAddress})`);
  const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, first.sshKeyId!) });
  if (!key?.privateKey) throw new Error("No SSH key found");
  const ssh = new SSHExecutor({ host: first.ipAddress!, port: first.sshPort || 22, username: first.sshUser || "root", privateKey: key.privateKey });
  await ssh.connect();
  return { ssh, server: first, cluster };
}

export const backupRouter = router({
  getConfig: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const config = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");
      if (!config) return null;
      return {
        id: config.id,
        clusterId: config.clusterId,
        s3Bucket: config.s3Bucket,
        cronSchedule: config.cronSchedule,
        retentionCount: config.retentionCount,
        enabled: config.enabled,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      };
    }),

  testConnection: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
      bucket: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const s3 = await getUserS3Config(ctx.session.user.id);
      if (!s3) throw new Error("S3 storage not configured. Add your S3 credentials in Settings.");

      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        await ensureAwsCli(ssh);
        await configureAwsCredentials(ssh, s3);

        const cmd = `aws s3 ls "s3://${input.bucket}/" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}" 2>&1 | head -5`;
        const result = await ssh.exec(cmd);
        const output = (result.stdout || "") + (result.stderr || "");

        const isError = output.toLowerCase().includes("error") || output.toLowerCase().includes("failed") || output.toLowerCase().includes("connect");
        if (isError && !output.includes("PRE")) {
          return { success: false, output: output.trim() };
        }
        return { success: true, output: output.trim() || "Connection successful" };
      } catch (err: any) {
        return { success: false, output: err.message };
      } finally {
        await ssh.disconnect();
      }
    }),

  saveConfig: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
      s3Bucket: z.string(),
      cronSchedule: z.string(),
      retentionCount: z.number().min(1).max(100),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const s3 = await getUserS3Config(ctx.session.user.id);
      if (!s3) throw new Error("S3 storage not configured. Add your S3 credentials in Settings.");

      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const existing = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });

      let configId: string;

      if (existing) {
        await db.update(clusterBackups).set({
          s3Bucket: input.s3Bucket,
          cronSchedule: input.cronSchedule,
          retentionCount: input.retentionCount,
          enabled: input.enabled ? 1 : 0,
          updatedAt: new Date(),
        }).where(eq(clusterBackups.id, existing.id));
        configId = existing.id;
      } else {
        configId = crypto.randomUUID();
        await db.insert(clusterBackups).values({
          id: configId,
          clusterId: input.clusterId,
          s3Bucket: input.s3Bucket,
          cronSchedule: input.cronSchedule,
          retentionCount: input.retentionCount,
          enabled: input.enabled ? 1 : 0,
        });
      }

      if (input.enabled) {
        const deployErrors = await deployBackupToCluster(cluster, s3, input, configId);
        if (deployErrors.length > 0) {
          console.error("Backup deploy errors:", deployErrors);
          // Still return success since config is saved, but log the errors
        }
      } else {
        await removeCronFromCluster(cluster);
      }

      return { success: true };
    }),

  removeConfig: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      await removeCronFromCluster(cluster);

      const existing = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      if (existing) {
        await db.delete(backupHistory).where(eq(backupHistory.configId, existing.id));
        await db.delete(clusterBackups).where(eq(clusterBackups.id, existing.id));
      }
      return { success: true };
    }),

  listBackups: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const s3 = await getUserS3Config(ctx.session.user.id);
      if (!s3) return [];

      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const config = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      if (!config) return [];

      // Get history from DB (fast, no SSH needed)
      const history = await db.query.backupHistory.findMany({
        where: and(
          eq(backupHistory.clusterId, input.clusterId),
          eq(backupHistory.status, "completed"),
        ),
        orderBy: [desc(backupHistory.startedAt)],
      });

      if (history.length > 0) {
        return history.map((h) => ({
          id: h.id,
          filename: h.filename,
          databaseName: h.databaseName,
          fileSizeBytes: h.fileSizeBytes || 0,
          s3Key: h.s3Key,
          startedAt: h.startedAt,
          completedAt: h.completedAt,
          triggeredBy: h.triggeredBy,
          source: "db" as const,
        }));
      }

      // Fallback: list from S3 via SSH (for legacy backups before history tracking)
      try {
        const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
        try {
          const result = await ssh.exec(
            `aws s3 ls "s3://${config.s3Bucket}/" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}" 2>/dev/null | grep "pg_backup_"`
          );
          const lines = (result.stdout || "").trim().split("\n").filter(Boolean);
          return lines.map((line) => {
            const parts = line.trim().split(/\s+/);
            const filename = parts[3] || "";
            const dbName = extractDbNameFromFilename(filename);
            return {
              id: "",
              filename,
              databaseName: dbName,
              fileSizeBytes: parseInt(parts[2] || "0", 10) || 0,
              s3Key: filename,
              startedAt: new Date(`${parts[0] || ""} ${parts[1] || ""}`),
              completedAt: null,
              triggeredBy: "unknown",
              source: "s3" as const,
            };
          }).reverse();
        } finally {
          await ssh.disconnect();
        }
      } catch {
        return [];
      }
    }),

  triggerBackup: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const s3 = await getUserS3Config(ctx.session.user.id);
      if (!s3) throw new Error("S3 storage not configured. Add your S3 credentials in Settings.");

      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const config = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      if (!config) throw new Error("Backup not configured");

      const { ssh, server: leaderServer } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        console.log(`[backup] triggerBackup: connected to leader ${leaderServer.role} (${leaderServer.ipAddress})`);

        const check = await ssh.exec("test -f /opt/haforge/backup.sh && echo 'exists' || echo 'missing'");
        console.log(`[backup] script check on ${leaderServer.role}: ${check.stdout?.trim()}`);

        if (check.stdout?.trim() === "missing") {
          // Debug: check what's in /opt/haforge/
          const lsResult = await ssh.exec("ls -la /opt/haforge/ 2>/dev/null || echo 'dir not found'");
          console.log(`[backup] /opt/haforge/ contents: ${lsResult.stdout}`);
          throw new Error(`Backup script not found on server (${leaderServer.role}/${leaderServer.ipAddress}). Save & Deploy first.`);
        }

        const result = await ssh.exec("timeout 300 /opt/haforge/backup.sh 2>&1; echo \"\\nEXIT_CODE:$?\"");
        const output = result.stdout || result.stderr || "";
        const exitMatch = output.match(/EXIT_CODE:(\d+)/);
        const exitCode = exitMatch ? parseInt(exitMatch[1]!) : 1;
        const cleanOutput = output.replace(/EXIT_CODE:\d+/, "").trim();

        const logResult = await ssh.exec("tail -20 /opt/haforge/backup.log 2>/dev/null");
        const logOutput = logResult.stdout?.trim() || "";

        // Record in backup history by parsing the log
        await recordBackupHistoryFromLog(ssh, config.id, input.clusterId, exitCode, "manual");

        if (exitCode !== 0) {
          return { success: false, output: cleanOutput || logOutput || "Unknown error" };
        }
        return { success: true, output: cleanOutput || logOutput || "Backup completed" };
      } finally {
        await ssh.disconnect();
      }
    }),

  getBackupLog: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      try {
        const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
        try {
          const result = await ssh.exec("tail -50 /opt/haforge/backup.log 2>/dev/null || echo 'No log file found'");
          return result.stdout || "";
        } finally {
          await ssh.disconnect();
        }
      } catch {
        return "Could not connect to server";
      }
    }),

  restoreBackup: protectedProcedure
    .input(z.object({ clusterId: z.string(), filename: z.string(), targetDb: z.string().default("postgres") }))
    .mutation(async ({ input, ctx }) => {
      const s3 = await getUserS3Config(ctx.session.user.id);
      if (!s3) throw new Error("S3 storage not configured. Add your S3 credentials in Settings.");

      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const config = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      if (!config) throw new Error("Backup not configured");

      const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        const s3Path = `s3://${config.s3Bucket}/${input.filename}`;
        const localPath = `/tmp/${input.filename}`;
        const dbUser = cluster.superuserUsername || "postgres";
        const dbPass = cluster.superuserPassword || "";

        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Starting restore: ${input.filename} -> ${input.targetDb}" >> /opt/haforge/backup.log`);

        const downloadResult = await ssh.exec(`aws s3 cp "${s3Path}" "${localPath}" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}" 2>&1`);
        if (downloadResult.stdout?.includes("error") || downloadResult.stderr?.includes("error")) {
          throw new Error(`Download failed: ${downloadResult.stdout || downloadResult.stderr}`);
        }

        const checkFile = await ssh.exec(`test -f "${localPath}" && stat -c%s "${localPath}" || echo "0"`);
        const fileSize = checkFile.stdout?.trim() || "0";
        if (fileSize === "0") {
          throw new Error("Downloaded file is empty or missing");
        }
        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Downloaded ${input.filename} (${fileSize} bytes)" >> /opt/haforge/backup.log`);

        // Create target database if it doesn't exist and isn't 'postgres'
        if (input.targetDb !== "postgres") {
          await ssh.exec(`PGPASSWORD="${dbPass}" psql -U "${dbUser}" -h 127.0.0.1 -d postgres -c 'CREATE DATABASE "${input.targetDb}"' 2>/dev/null || true`);
        }

        // Use sslmode=require to match the Patroni SSL configuration
        let restoreCmd: string;
        if (input.targetDb === "postgres") {
          restoreCmd = `PGPASSWORD="${dbPass}" pg_restore -U "${dbUser}" -h 127.0.0.1 -d postgres --clean --if-exists "${localPath}" 2>&1`;
        } else {
          restoreCmd = `PGPASSWORD="${dbPass}" pg_restore -U "${dbUser}" -h 127.0.0.1 -d "${input.targetDb}" --clean --if-exists "${localPath}" 2>&1`;
        }

        const restoreResult = await ssh.exec(restoreCmd);
        const restoreOutput = restoreResult.stdout || restoreResult.stderr || "";

        // pg_restore returns non-zero for warnings too; only treat as error if there are actual ERROR lines
        const hasFatalError = restoreOutput.split("\n").some((line: string) =>
          line.includes("ERROR:") && !line.includes("does not exist") && !line.includes("already exists")
        );

        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Restore ${hasFatalError ? "FAILED" : "completed"}: ${input.filename}" >> /opt/haforge/backup.log`);
        await ssh.exec(`rm -f "${localPath}"`);

        if (hasFatalError) {
          return { success: false, output: restoreOutput };
        }
        return { success: true, output: restoreOutput || "Restore completed" };
      } finally {
        await ssh.disconnect();
      }
    }),

  deleteBackup: protectedProcedure
    .input(z.object({ clusterId: z.string(), filename: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const s3 = await getUserS3Config(ctx.session.user.id);
      if (!s3) throw new Error("S3 storage not configured. Add your S3 credentials in Settings.");

      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const config = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      if (!config) throw new Error("Backup not configured");

      const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        await ssh.exec(`aws s3 rm "s3://${config.s3Bucket}/${input.filename}" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}"`);

        // Update history status
        const historyEntry = await db.query.backupHistory.findFirst({
          where: and(eq(backupHistory.clusterId, input.clusterId), eq(backupHistory.filename, input.filename)),
        });
        if (historyEntry) {
          await db.update(backupHistory).set({ status: "deleted" }).where(eq(backupHistory.id, historyEntry.id));
        }

        return { success: true };
      } finally {
        await ssh.disconnect();
      }
    }),

  downloadBackup: protectedProcedure
    .input(z.object({ clusterId: z.string(), filename: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const s3 = await getUserS3Config(ctx.session.user.id);
      if (!s3) throw new Error("S3 storage not configured. Add your S3 credentials in Settings.");

      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const config = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      if (!config) throw new Error("Backup not configured");

      const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        const localPath = `/tmp/haforge_dl_${input.filename}`;
        await ssh.exec(`aws s3 cp "s3://${config.s3Bucket}/${input.filename}" "${localPath}" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}" 2>&1`);

        // Check file size first to avoid memory issues with huge files
        const sizeResult = await ssh.exec(`stat -c%s "${localPath}" 2>/dev/null || echo "0"`);
        const fileSize = parseInt(sizeResult.stdout?.trim() || "0", 10);

        // For files > 100MB, use streaming chunked approach
        if (fileSize > 100 * 1024 * 1024) {
          // Split and encode in chunks to avoid memory issues
          const chunks: string[] = [];
          const chunkSize = 10 * 1024 * 1024; // 10MB chunks
          const totalChunks = Math.ceil(fileSize / chunkSize);

          for (let i = 0; i < totalChunks; i++) {
            const skip = i * chunkSize;
            const count = Math.min(chunkSize, fileSize - skip);
            const chunkResult = await ssh.exec(`dd if="${localPath}" bs=1M skip=${Math.floor(skip / (1024 * 1024))} count=${Math.ceil(count / (1024 * 1024))} 2>/dev/null | base64 -w0`);
            if (chunkResult.stdout) chunks.push(chunkResult.stdout);
          }

          await ssh.exec(`rm -f "${localPath}"`);
          return { data: chunks.join(""), filename: input.filename, fileSize };
        }

        // For smaller files, use simple base64
        const result = await ssh.exec(`base64 -w0 "${localPath}"`);
        await ssh.exec(`rm -f "${localPath}"`);
        if (!result.stdout) throw new Error("Failed to read backup file");
        return { data: result.stdout, filename: input.filename, fileSize };
      } finally {
        await ssh.disconnect();
      }
    }),

  getHistory: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const history = await db.query.backupHistory.findMany({
        where: and(
          eq(backupHistory.clusterId, input.clusterId),
        ),
        orderBy: [desc(backupHistory.startedAt)],
        limit: 100,
      });

      return history.map((h) => ({
        id: h.id,
        filename: h.filename,
        databaseName: h.databaseName,
        status: h.status,
        fileSizeBytes: h.fileSizeBytes || 0,
        errorMessage: h.errorMessage,
        triggeredBy: h.triggeredBy,
        startedAt: h.startedAt,
        completedAt: h.completedAt,
      }));
    }),
});

// Helper functions

async function ensureAwsCli(ssh: any) {
  const check = await ssh.exec("which aws 2>/dev/null && echo 'found' || echo 'missing'");
  if (check.stdout?.trim() === "found") return;

  // Install AWS CLI via pip3
  await ssh.exec("sudo apt-get update -qq && sudo apt-get install -y -qq python3-pip 2>&1 | tail -3 && pip3 install --break-system-packages awscli 2>&1 | tail -3");
}

async function configureAwsCredentials(ssh: any, s3: { s3AccessKey: string; s3SecretKey: string; s3Region: string }) {
  await ssh.exec("mkdir -p ~/.aws");
  await ssh.exec(`printf '[default]\\naws_access_key_id = ${s3.s3AccessKey}\\naws_secret_access_key = ${s3.s3SecretKey}\\n' > ~/.aws/credentials`);
  await ssh.exec("chmod 600 ~/.aws/credentials");
  await ssh.exec(`printf '[default]\\nregion = ${s3.s3Region}\\n' > ~/.aws/config`);
}

async function deployBackupToCluster(
  cluster: any,
  s3: { s3AccessKey: string; s3SecretKey: string; s3Region: string; s3Endpoint: string },
  input: { s3Bucket: string; cronSchedule: string; retentionCount: number },
  _configId: string,
): Promise<string[]> {
  const pgServers = cluster.servers.filter((s: any) => s.role?.startsWith("postgresql"));
  const { SSHExecutor } = await import("../services/ssh-executor");
  const errors: string[] = [];

  for (const pgServer of pgServers) {
    if (!pgServer.ipAddress || !pgServer.sshKeyId) {
      errors.push(`${pgServer.role}: missing IP or SSH key`);
      continue;
    }
    const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, pgServer.sshKeyId) });
    if (!key?.privateKey) {
      errors.push(`${pgServer.role}: no private key found`);
      continue;
    }

    try {
      const ssh = new SSHExecutor({ host: pgServer.ipAddress, port: pgServer.sshPort || 22, username: pgServer.sshUser || "root", privateKey: key.privateKey });
      await ssh.connect();
      try {
        // Ensure AWS CLI is installed (any version is fine)
        const awsCheck = await ssh.exec("which aws 2>/dev/null || ls ~/.local/bin/aws 2>/dev/null || echo 'missing'");
        if (awsCheck.stdout?.trim() === "missing" || !awsCheck.stdout?.trim()) {
          console.log(`Installing AWS CLI on ${pgServer.role} via pip3...`);
          const installResult = await ssh.exec("sudo apt-get update -qq && sudo apt-get install -y -qq python3-pip 2>&1 | tail -3 && pip3 install --break-system-packages awscli 2>&1 | tail -3");
          console.log(`AWS CLI install on ${pgServer.role}:`, installResult.stdout?.slice(-200), installResult.stderr?.slice(-200));
          // Verify
          const verify = await ssh.exec("which aws 2>/dev/null || ls ~/.local/bin/aws 2>/dev/null || echo 'still missing'");
          console.log(`AWS CLI verify on ${pgServer.role}: ${verify.stdout?.trim()}`);
        } else {
          console.log(`AWS CLI already present on ${pgServer.role}: ${awsCheck.stdout?.trim()}`);
        }

        await configureAwsCredentials(ssh, s3);

        const script = backupScriptContent(
          pgServer.privateIpAddress || "",
          input.s3Bucket,
          "",
          s3.s3Endpoint,
          s3.s3Region,
          input.retentionCount,
          cluster.superuserUsername || "postgres",
          cluster.superuserPassword || "",
        );
        await ssh.exec("sudo mkdir -p /opt/haforge");
        await ssh.exec(`sudo chown $(whoami):$(whoami) /opt/haforge`);
        await ssh.exec(`cat > /opt/haforge/backup.sh << 'HAFORGE_SCRIPT_EOF'\n${script}\nHAFORGE_SCRIPT_EOF`);
        await ssh.exec("chmod +x /opt/haforge/backup.sh");
        await ssh.exec("touch /opt/haforge/backup.log && chmod 644 /opt/haforge/backup.log");

        // Verify the script was written
        const verifyResult = await ssh.exec("test -f /opt/haforge/backup.sh && echo 'exists' || echo 'missing'");
        if (verifyResult.stdout?.trim() !== "exists") {
          errors.push(`${pgServer.role}: backup script not created on server`);
          continue;
        }

        await ssh.exec("sudo touch /opt/haforge/backup.log && sudo chmod 666 /opt/haforge/backup.log");
        await ssh.exec(`(crontab -l 2>/dev/null | grep -v 'haforge/backup.sh'; echo "${input.cronSchedule} /opt/haforge/backup.sh >> /opt/haforge/backup.log 2>&1") | crontab -`);

        console.log(`Backup deployed to ${pgServer.role} (${pgServer.ipAddress})`);
      } finally {
        await ssh.disconnect();
      }
    } catch (err) {
      const msg = `${pgServer.role}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`Failed to deploy backup to ${pgServer.role}:`, err);
    }
  }

  return errors;
}

async function removeCronFromCluster(cluster: any) {
  const pgServers = cluster.servers.filter((s: any) => s.role?.startsWith("postgresql"));
  const { SSHExecutor } = await import("../services/ssh-executor");
  for (const pgServer of pgServers) {
    if (!pgServer.ipAddress || !pgServer.sshKeyId) continue;
    try {
      const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, pgServer.sshKeyId) });
      if (!key?.privateKey) continue;
      const ssh = new SSHExecutor({ host: pgServer.ipAddress, port: pgServer.sshPort || 22, username: pgServer.sshUser || "root", privateKey: key.privateKey });
      await ssh.connect();
      try {
        await ssh.exec(`crontab -l 2>/dev/null | grep -v 'haforge/backup.sh' | crontab -`);
        await ssh.exec("rm -f /opt/haforge/backup.sh");
      } finally {
        await ssh.disconnect();
      }
    } catch { /* ignore */ }
  }
}

async function recordBackupHistoryFromLog(ssh: any, configId: string, clusterId: string, exitCode: number, triggeredBy: string) {
  try {
    // Parse the log to find which databases were backed up
    const logResult = await ssh.exec("tail -30 /opt/haforge/backup.log 2>/dev/null");
    const log = logResult.stdout || "";

    // Extract filenames from log lines like "Backup complete: pg_backup_dbname_20250101_120000.dump"
    const backupRegex = /Backup complete: (pg_backup_\S+\.dump)/g;
    let match;
    const filenames: string[] = [];
    while ((match = backupRegex.exec(log)) !== null) {
      filenames.push(match[1]!);
    }

    for (const filename of filenames) {
      const dbName = extractDbNameFromFilename(filename);
      const historyId = crypto.randomUUID();

      // Try to get file size from S3
      let fileSize: number | null = null;
      try {
        const config = await db.query.clusterBackups.findFirst({ where: eq(clusterBackups.id, configId) });
        if (config) {
          const s3 = await getUserS3Config((await db.query.clusters.findFirst({ where: eq(clusters.id, clusterId) }))?.userId || "");
          if (s3) {
            const sizeResult = await ssh.exec(`aws s3 ls "s3://${config.s3Bucket}/${filename}" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}" 2>/dev/null`);
            const parts = sizeResult.stdout?.trim().split(/\s+/);
            if (parts && parts.length >= 3) fileSize = parseInt(parts[2], 10) || null;
          }
        }
      } catch { /* ignore */ }

      await db.insert(backupHistory).values({
        id: historyId,
        clusterId,
        configId,
        filename,
        databaseName: dbName,
        status: exitCode === 0 ? "completed" : "failed",
        fileSizeBytes: fileSize,
        s3Key: filename,
        triggeredBy,
        completedAt: new Date(),
      });
    }
  } catch (err) {
    console.error("Failed to record backup history:", err);
  }
}

function extractDbNameFromFilename(filename: string): string {
  // pg_backup_dbname_20250101_120000.dump -> dbname
  const match = filename.match(/^pg_backup_(.+?)_\d{8}_\d{6}\.dump$/);
  if (match) return match[1]!.replace(/_/g, "_");
  if (filename.includes("globals")) return "globals";
  return "unknown";
}
