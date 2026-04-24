import { db } from "@HAForge/db";
import { clusterBackups, clusters, servers, sshKeys } from "@HAForge/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { backupScriptContent } from "../templates/backup/backup-script";

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
        ...config,
        s3SecretKey: config.s3SecretKey ? "••••••••" : "",
      };
    }),

  testConnection: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
      endpoint: z.string(),
      region: z.string(),
      bucket: z.string(),
      accessKey: z.string(),
      secretKey: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
      try {
        // Ensure awscli is installed
        const awsCheck = await ssh.exec("which aws 2>/dev/null || echo 'missing'");
        if (awsCheck.stdout?.trim() === "missing") {
          await ssh.exec("apt-get update -qq && apt-get install -y -qq python3-pip 2>&1 | tail -3 && pip3 install --break-system-packages awscli 2>&1 | tail -3");
        }

        // Write temp credentials using printf to avoid heredoc issues
        await ssh.exec("mkdir -p ~/.aws");
        await ssh.exec(`printf '[default]\\naws_access_key_id = ${input.accessKey}\\naws_secret_access_key = ${input.secretKey}\\n' > ~/.aws/credentials`);
        await ssh.exec(`printf '[default]\\nregion = ${input.region}\\n' > ~/.aws/config`);
        await ssh.exec("chmod 600 ~/.aws/credentials");

        // Test connection with proper quoting
        const cmd = `aws s3 ls "s3://${input.bucket}/" --endpoint-url "${input.endpoint}" --region "${input.region}" 2>&1 | head -5`;
        const result = await ssh.exec(cmd);
        const output = (result.stdout || "") + (result.stderr || "");

        // Check if the output indicates an error
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
      s3Endpoint: z.string(),
      s3Region: z.string(),
      s3Bucket: z.string(),
      s3AccessKey: z.string(),
      s3SecretKey: z.string(),
      s3PathPrefix: z.string().optional(),
      cronSchedule: z.string(),
      retentionCount: z.number().min(1).max(100),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      // Upsert config
      const existing = await db.query.clusterBackups.findFirst({
        where: eq(clusterBackups.clusterId, input.clusterId),
      });

      let secretKey = input.s3SecretKey;
      if (existing && secretKey === "••••••••") {
        secretKey = existing.s3SecretKey;
      }

      if (existing) {
        await db.update(clusterBackups).set({
          s3Endpoint: input.s3Endpoint,
          s3Region: input.s3Region,
          s3Bucket: input.s3Bucket,
          s3AccessKey: input.s3AccessKey,
          s3SecretKey: secretKey,
          s3PathPrefix: input.s3PathPrefix || null,
          cronSchedule: input.cronSchedule,
          retentionCount: input.retentionCount,
          enabled: input.enabled ? 1 : 0,
          updatedAt: new Date(),
        }).where(eq(clusterBackups.id, existing.id));
      } else {
        await db.insert(clusterBackups).values({
          clusterId: input.clusterId,
          s3Endpoint: input.s3Endpoint,
          s3Region: input.s3Region,
          s3Bucket: input.s3Bucket,
          s3AccessKey: input.s3AccessKey,
          s3SecretKey: secretKey,
          s3PathPrefix: input.s3PathPrefix || null,
          cronSchedule: input.cronSchedule,
          retentionCount: input.retentionCount,
          enabled: input.enabled ? 1 : 0,
        });
      }

      // Deploy to leader node if enabled
      if (input.enabled) {
        const { ssh, server } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
        try {
          // Install awscli via pip (apt version is often outdated)
          await ssh.exec("which aws 2>/dev/null || (apt-get update -qq && apt-get install -y -qq python3-pip 2>&1 | tail -3 && pip3 install --break-system-packages awscli 2>&1 | tail -3)");

          // Write AWS credentials using printf
          await ssh.exec("mkdir -p ~/.aws");
          await ssh.exec(`printf '[default]\\naws_access_key_id = ${input.s3AccessKey}\\naws_secret_access_key = ${secretKey}\\n' > ~/.aws/credentials`);
          await ssh.exec("chmod 600 ~/.aws/credentials");
          await ssh.exec(`printf '[default]\\nregion = ${input.s3Region}\\n' > ~/.aws/config`);

          // Deploy backup script
          const prefix = input.s3PathPrefix || "";
          const script = backupScriptContent(
            server.privateIpAddress || "",
            input.s3Bucket,
            prefix,
            input.s3Endpoint,
            input.s3Region,
            input.retentionCount,
            cluster.superuserUsername || "postgres",
            "postgres",
            cluster.superuserPassword || "",
          );
          await ssh.exec("mkdir -p /opt/haforge");
          await ssh.exec(`cat > /opt/haforge/backup.sh << 'HAFORGE_SCRIPT_EOF'\n${script}\nHAFORGE_SCRIPT_EOF`);
          await ssh.exec("chmod +x /opt/haforge/backup.sh");

          // Create log file
          await ssh.exec("touch /var/log/haforge-backup.log && chmod 644 /var/log/haforge-backup.log");

          // Update crontab
          await ssh.exec(`(crontab -l 2>/dev/null | grep -v 'haforge/backup.sh'; echo "${input.cronSchedule} /opt/haforge/backup.sh >> /var/log/haforge-backup.log 2>&1") | crontab -`);
        } finally {
          await ssh.disconnect();
        }
      } else {
        // Disable: remove cron entry
        try {
          const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
          try {
            await ssh.exec(`crontab -l 2>/dev/null | grep -v 'haforge/backup.sh' | crontab -`);
          } finally {
            await ssh.disconnect();
          }
        } catch { /* ignore if can't connect */ }
      }

      return { success: true };
    }),

  removeConfig: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      // Remove cron + script from server
      try {
        const { ssh } = await getClusterLeaderSsh(input.clusterId, ctx.session.user.id);
        try {
          await ssh.exec(`crontab -l 2>/dev/null | grep -v 'haforge/backup.sh' | crontab -`);
          await ssh.exec("rm -f /opt/haforge/backup.sh ~/.aws/credentials ~/.aws/config");
        } finally {
          await ssh.disconnect();
        }
      } catch { /* ignore */ }

      // Delete DB record
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
        const prefix = config.s3PathPrefix ? `${config.s3PathPrefix}/` : "";
        const result = await ssh.exec(
          `aws s3 ls "s3://${config.s3Bucket}/${prefix}" --endpoint-url "${config.s3Endpoint}" --region "${config.s3Region}" 2>/dev/null | grep "pg_backup_"`
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
        // Check if script exists
        const check = await ssh.exec("test -f /opt/haforge/backup.sh && echo 'exists' || echo 'missing'");
        if (check.stdout?.trim() === "missing") {
          throw new Error("Backup script not found on server. Save & Deploy first.");
        }
        // Run backup script synchronously, capture output
        const result = await ssh.exec("timeout 120 /opt/haforge/backup.sh 2>&1; echo \"\\nEXIT_CODE:$?\"");
        const output = result.stdout || result.stderr || "";
        const exitMatch = output.match(/EXIT_CODE:(\d+)/);
        const exitCode = exitMatch ? parseInt(exitMatch[1]) : 1;
        const cleanOutput = output.replace(/EXIT_CODE:\d+/, "").trim();

        // Also read the log file for details
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
        const prefix = config.s3PathPrefix ? `${config.s3PathPrefix}/` : "";
        const s3Path = `s3://${config.s3Bucket}/${prefix}${input.filename}`;
        const localPath = `/tmp/${input.filename}`;
        const dbUser = cluster.superuserUsername || "postgres";
        const dbPass = cluster.superuserPassword || "";

        // Log restore start
        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Starting restore: ${input.filename} -> ${input.targetDb}" >> /var/log/haforge-backup.log`);

        // Download from S3
        const downloadResult = await ssh.exec(`aws s3 cp "${s3Path}" "${localPath}" --endpoint-url "${config.s3Endpoint}" --region "${config.s3Region}" 2>&1`);
        if (downloadResult.stdout?.includes("error") || downloadResult.stderr?.includes("error")) {
          throw new Error(`Download failed: ${downloadResult.stdout || downloadResult.stderr}`);
        }

        // Verify file downloaded
        const checkFile = await ssh.exec(`test -f "${localPath}" && stat -c%s "${localPath}" || echo "0"`);
        const fileSize = checkFile.stdout?.trim() || "0";
        if (fileSize === "0") {
          throw new Error("Downloaded file is empty or missing");
        }
        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Downloaded ${input.filename} (${fileSize} bytes)" >> /var/log/haforge-backup.log`);

        // Restore
        let restoreCmd: string;
        if (input.targetDb === "postgres") {
          // Restore to postgres DB: clean existing objects first, then restore
          restoreCmd = `PGPASSWORD="${dbPass}" pg_restore -U "${dbUser}" -h 127.0.0.1 -d postgres --clean --if-exists "${localPath}" 2>&1`;
        } else {
          // Create target DB if not exists, then restore into it
          await ssh.exec(`PGPASSWORD="${dbPass}" psql -U "${dbUser}" -h 127.0.0.1 -c "CREATE DATABASE \\"${input.targetDb}\\"" 2>/dev/null || true`);
          restoreCmd = `PGPASSWORD="${dbPass}" pg_restore -U "${dbUser}" -h 127.0.0.1 -d "${input.targetDb}" "${localPath}" 2>&1`;
        }

        const restoreResult = await ssh.exec(restoreCmd);
        const restoreOutput = restoreResult.stdout || restoreResult.stderr || "";

        // pg_restore outputs warnings to stderr but that's normal — only fail on fatal errors
        const hasFatalError = restoreOutput.toLowerCase().includes("error:") && !restoreOutput.includes("does not exist");
        await ssh.exec(`echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] Restore ${hasFatalError ? "FAILED" : "completed"}: ${input.filename}" >> /var/log/haforge-backup.log`);

        // Cleanup
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
        const prefix = config.s3PathPrefix ? `${config.s3PathPrefix}/` : "";
        await ssh.exec(`aws s3 rm "s3://${config.s3Bucket}/${prefix}${input.filename}" --endpoint-url "${config.s3Endpoint}" --region "${config.s3Region}"`);
        return { success: true };
      } finally {
        await ssh.disconnect();
      }
    }),
});
