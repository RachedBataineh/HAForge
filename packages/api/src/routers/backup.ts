import { db } from "@HAForge/db";
import { clusterBackups, clusters, servers, sshKeys } from "@HAForge/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { backupScriptContent } from "../templates/backup/backup-script";
import { getUserS3Config } from "./settings";

async function getClusterLeaderSsh(clusterId: string, userId: string) {
  const cluster = await db.query.clusters.findFirst({
    where: and(eq(clusters.id, clusterId), eq(clusters.userId, userId)),
    with: { servers: true },
  });
  if (!cluster) throw new Error("Cluster not found or access denied");

  const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
  const { SSHExecutor } = await import("../services/ssh-executor");

  // Try to find the leader and return a live SSH connection
  for (const s of pgServers) {
    if (!s.ipAddress || !s.sshKeyId) continue;
    const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, s.sshKeyId) });
    if (!key?.privateKey) continue;
    try {
      const ssh = new SSHExecutor({ host: s.ipAddress, port: s.sshPort || 22, username: s.sshUser || "root", privateKey: key.privateKey });
      await ssh.connect();
      const result = await ssh.exec("patronictl -c /etc/patroni/config.yml list --format json 2>/dev/null || echo '[]'");
      const parsed: any[] = JSON.parse(result.stdout || "[]");
      // Check if THIS server is the leader
      const myMatch = parsed.find((p: any) => {
        const host = (p.Host || "").split(":")[0];
        return host === s.privateIpAddress;
      });
      if (myMatch && myMatch.Role?.includes("Leader")) {
        return { ssh, server: s, cluster };
      }
      // Also check if any other server is the leader — use this connection's data to find it
      for (const s2 of pgServers) {
        if (!s2.privateIpAddress) continue;
        const matched = parsed.find((p: any) => {
          const host = (p.Host || "").split(":")[0];
          return host === s2.privateIpAddress;
        });
        if (matched && matched.Role?.includes("Leader")) {
          // Disconnect from this server, connect to the leader
          await ssh.disconnect();
          if (!s2.ipAddress || !s2.sshKeyId) continue;
          const key2 = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, s2.sshKeyId) });
          if (!key2?.privateKey) continue;
          const ssh2 = new SSHExecutor({ host: s2.ipAddress, port: s2.sshPort || 22, username: s2.sshUser || "root", privateKey: key2.privateKey });
          await ssh2.connect();
          return { ssh: ssh2, server: s2, cluster };
        }
      }
      // Not the leader and leader not found via this node — disconnect and try next
      await ssh.disconnect();
    } catch { continue; }
  }

  // Fallback: connect to first available server
  const first = pgServers.find((s) => s.ipAddress && s.sshKeyId);
  if (!first) throw new Error("No accessible PG server found");
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
      // Verify ownership
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
        const awsCheck = await ssh.exec("which aws 2>/dev/null || echo 'missing'");
        if (awsCheck.stdout?.trim() === "missing") {
          await ssh.exec("apt-get update -qq && apt-get install -y -qq python3-pip 2>&1 | tail -3 && pip3 install --break-system-packages awscli 2>&1 | tail -3");
        }

        await ssh.exec("mkdir -p ~/.aws");
        await ssh.exec(`printf '[default]\\naws_access_key_id = ${s3.s3AccessKey}\\naws_secret_access_key = ${s3.s3SecretKey}\\n' > ~/.aws/credentials`);
        await ssh.exec(`printf '[default]\\nregion = ${s3.s3Region}\\n' > ~/.aws/config`);
        await ssh.exec("chmod 600 ~/.aws/credentials");

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

      // Upsert config
      const existing = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });

      if (existing) {
        await db.update(clusterBackups).set({
          s3Bucket: input.s3Bucket,
          cronSchedule: input.cronSchedule,
          retentionCount: input.retentionCount,
          enabled: input.enabled ? 1 : 0,
          updatedAt: new Date(),
        }).where(eq(clusterBackups.id, existing.id));
      } else {
        await db.insert(clusterBackups).values({
          clusterId: input.clusterId,
          s3Bucket: input.s3Bucket,
          cronSchedule: input.cronSchedule,
          retentionCount: input.retentionCount,
          enabled: input.enabled ? 1 : 0,
        });
      }

      // Deploy to PG nodes if enabled
      if (input.enabled) {
        const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
        const { SSHExecutor } = await import("../services/ssh-executor");

        for (const pgServer of pgServers) {
          if (!pgServer.ipAddress || !pgServer.sshKeyId) continue;
          const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, pgServer.sshKeyId) });
          if (!key?.privateKey) continue;

          try {
            const ssh = new SSHExecutor({ host: pgServer.ipAddress, port: pgServer.sshPort || 22, username: pgServer.sshUser || "root", privateKey: key.privateKey });
            await ssh.connect();
            try {
              await ssh.exec("which aws 2>/dev/null || (apt-get update -qq && apt-get install -y -qq python3-pip 2>&1 | tail -3 && pip3 install --break-system-packages awscli 2>&1 | tail -3)");

              await ssh.exec("mkdir -p ~/.aws");
              await ssh.exec(`printf '[default]\\naws_access_key_id = ${s3.s3AccessKey}\\naws_secret_access_key = ${s3.s3SecretKey}\\n' > ~/.aws/credentials`);
              await ssh.exec("chmod 600 ~/.aws/credentials");
              await ssh.exec(`printf '[default]\\nregion = ${s3.s3Region}\\n' > ~/.aws/config`);

              const script = backupScriptContent(
                pgServer.privateIpAddress || "",
                input.s3Bucket,
                "",
                s3.s3Endpoint,
                s3.s3Region,
                input.retentionCount,
                cluster.superuserUsername || "postgres",
                "postgres",
                cluster.superuserPassword || "",
              );
              await ssh.exec("mkdir -p /opt/haforge");
              await ssh.exec(`cat > /opt/haforge/backup.sh << 'HAFORGE_SCRIPT_EOF'\n${script}\nHAFORGE_SCRIPT_EOF`);
              await ssh.exec("chmod +x /opt/haforge/backup.sh");
              await ssh.exec("touch /var/log/haforge-backup.log && chmod 644 /var/log/haforge-backup.log");
              await ssh.exec(`(crontab -l 2>/dev/null | grep -v 'haforge/backup.sh'; echo "${input.cronSchedule} /opt/haforge/backup.sh >> /var/log/haforge-backup.log 2>&1") | crontab -`);
            } finally {
              await ssh.disconnect();
            }
          } catch (err) {
            console.error(`Failed to deploy backup to ${pgServer.role}:`, err);
          }
        }
      } else {
        const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
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
            } finally {
              await ssh.disconnect();
            }
          } catch { /* ignore */ }
        }
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

      const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
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
            // Note: don't remove ~/.aws/credentials as other clusters may use them
          } finally {
            await ssh.disconnect();
          }
        } catch { /* ignore */ }
      }

      const existing = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });
      if (existing) {
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

      const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        const result = await ssh.exec(
          `aws s3 ls "s3://${config.s3Bucket}/" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}" 2>/dev/null | grep "pg_backup_"`
        );
        const lines = (result.stdout || "").trim().split("\n").filter(Boolean);
        return lines.map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            date: `${parts[0]} ${parts[1]}`,
            size: parts[2],
            filename: parts[3],
          };
        }).reverse();
      } finally {
        await ssh.disconnect();
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

      const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        const check = await ssh.exec("test -f /opt/haforge/backup.sh && echo 'exists' || echo 'missing'");
        if (check.stdout?.trim() === "missing") {
          throw new Error("Backup script not found on server. Save & Deploy first.");
        }
        const result = await ssh.exec("timeout 120 /opt/haforge/backup.sh 2>&1; echo \"\\nEXIT_CODE:$?\"");
        const output = result.stdout || result.stderr || "";
        const exitMatch = output.match(/EXIT_CODE:(\d+)/);
        const exitCode = exitMatch ? parseInt(exitMatch[1]) : 1;
        const cleanOutput = output.replace(/EXIT_CODE:\d+/, "").trim();

        const logResult = await ssh.exec("tail -20 /var/log/haforge-backup.log 2>/dev/null");
        const logOutput = logResult.stdout?.trim() || "";

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
          const result = await ssh.exec("tail -50 /var/log/haforge-backup.log 2>/dev/null || echo 'No log file found'");
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

        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Starting restore: ${input.filename} -> ${input.targetDb}" >> /var/log/haforge-backup.log`);

        const downloadResult = await ssh.exec(`aws s3 cp "${s3Path}" "${localPath}" --endpoint-url "${s3.s3Endpoint}" --region "${s3.s3Region}" 2>&1`);
        if (downloadResult.stdout?.includes("error") || downloadResult.stderr?.includes("error")) {
          throw new Error(`Download failed: ${downloadResult.stdout || downloadResult.stderr}`);
        }

        const checkFile = await ssh.exec(`test -f "${localPath}" && stat -c%s "${localPath}" || echo "0"`);
        const fileSize = checkFile.stdout?.trim() || "0";
        if (fileSize === "0") {
          throw new Error("Downloaded file is empty or missing");
        }
        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Downloaded ${input.filename} (${fileSize} bytes)" >> /var/log/haforge-backup.log`);

        let restoreCmd: string;
        if (input.targetDb === "postgres") {
          restoreCmd = `PGPASSWORD="${dbPass}" pg_restore -U "${dbUser}" -h 127.0.0.1 -d postgres --clean --if-exists "${localPath}" 2>&1`;
        } else {
          await ssh.exec(`PGPASSWORD="${dbPass}" psql -U "${dbUser}" -h 127.0.0.1 -c "CREATE DATABASE \\"${input.targetDb}\\"" 2>/dev/null || true`);
          restoreCmd = `PGPASSWORD="${dbPass}" pg_restore -U "${dbUser}" -h 127.0.0.1 -d "${input.targetDb}" "${localPath}" 2>&1`;
        }

        const restoreResult = await ssh.exec(restoreCmd);
        const restoreOutput = restoreResult.stdout || restoreResult.stderr || "";
        const hasFatalError = restoreOutput.toLowerCase().includes("error:") && !restoreOutput.includes("does not exist");
        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Restore ${hasFatalError ? "FAILED" : "completed"}: ${input.filename}" >> /var/log/haforge-backup.log`);
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
        const result = await ssh.exec(`base64 "${localPath}"`);
        await ssh.exec(`rm -f "${localPath}"`);
        if (!result.stdout) throw new Error("Failed to read backup file");
        return { data: result.stdout.replace(/\n/g, ""), filename: input.filename };
      } finally {
        await ssh.disconnect();
      }
    }),
});
