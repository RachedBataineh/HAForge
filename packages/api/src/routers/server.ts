import { db } from "@HAForge/db";
import { clusters, servers, sshKeys } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { SSHExecutor } from "../services/ssh-executor";

async function verifyServerOwnership(serverId: string, userId: string) {
  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) throw new Error("Server not found");
  if (server.userId && server.userId !== userId) throw new Error("Access denied");
  if (!server.userId && server.clusterId) {
    const cluster = await db.query.clusters.findFirst({ where: eq(clusters.id, server.clusterId) });
    if (cluster && cluster.userId !== userId) throw new Error("Access denied");
  }
  return server;
}

export const serverRouter = router({
  add: protectedProcedure
    .input(
      z.object({
        clusterId: z.string().optional(),
        hostname: z.string().optional(),
        ipAddress: z.string().optional(),
        sshPort: z.number().default(22),
        sshUser: z.string().default("root"),
        sshKeyId: z.string().optional(),
        role: z.enum([
          "postgresql_1",
          "postgresql_2",
          "postgresql_3",
          "haproxy_1",
          "haproxy_2",
          "haproxy_3",
        ]),
        hetznerServerId: z.string().optional(),
        privateIpAddress: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [server] = await db
        .insert(servers)
        .values({
          ...input,
          userId: ctx.session.user.id,
          status: "pending",
        })
        .returning();
      return server;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        hostname: z.string().optional(),
        ipAddress: z.string().optional(),
        sshPort: z.number().optional(),
        sshUser: z.string().optional(),
        sshKeyId: z.string().optional().nullable(),
        hetznerServerId: z.string().optional(),
        privateIpAddress: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.id, ctx.session.user.id);
      const { id, ...data } = input;
      const [server] = await db
        .update(servers)
        .set(data)
        .where(eq(servers.id, id))
        .returning();
      return server;
    }),

  assignSshKey: protectedProcedure
    .input(
      z.object({
        hetznerServerId: z.string(),
        sshKeyId: z.string().nullable(),
        ipAddress: z.string().optional(),
        privateIpAddress: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the SSH key belongs to this user
      if (input.sshKeyId) {
        const key = await db.query.sshKeys.findFirst({
          where: eq(sshKeys.id, input.sshKeyId),
        });
        if (!key || key.userId !== ctx.session.user.id) throw new Error("SSH key not found or access denied");
      }

      // Find existing server record by hetznerServerId
      const existing = await db.query.servers.findFirst({
        where: eq(servers.hetznerServerId, input.hetznerServerId),
      });

      if (existing) {
        // Check ownership
        if (existing.userId && existing.userId !== ctx.session.user.id) throw new Error("Access denied");
        const updates: any = { sshKeyId: input.sshKeyId };
        if (!existing.userId) updates.userId = ctx.session.user.id;
        if (input.ipAddress && !existing.ipAddress) updates.ipAddress = input.ipAddress;
        if (input.privateIpAddress && !existing.privateIpAddress) updates.privateIpAddress = input.privateIpAddress;
        const [updated] = await db
          .update(servers)
          .set(updates)
          .where(eq(servers.id, existing.id))
          .returning();
        return updated;
      }

      // No DB record yet — create a standalone one (no cluster)
      const [created] = await db
        .insert(servers)
        .values({
          userId: ctx.session.user.id,
          hetznerServerId: input.hetznerServerId,
          ipAddress: input.ipAddress || "",
          privateIpAddress: input.privateIpAddress || "",
          role: "postgresql_1",
          sshKeyId: input.sshKeyId,
          status: "pending",
        })
        .returning();
      return created;
    }),

  getByHetznerId: protectedProcedure
    .input(z.object({ hetznerServerId: z.string() }))
    .query(async ({ input, ctx }) => {
      const server = await db.query.servers.findFirst({
        where: eq(servers.hetznerServerId, input.hetznerServerId),
      });
      if (!server) return null;
      const ownerId = server.userId;
      if (ownerId && ownerId !== ctx.session.user.id) return null;
      if (!ownerId && server.clusterId) {
        const cluster = await db.query.clusters.findFirst({ where: eq(clusters.id, server.clusterId) });
        if (cluster && cluster.userId !== ctx.session.user.id) return null;
      }
      return server;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.id, ctx.session.user.id);
      await db.delete(servers).where(eq(servers.id, input.id));
      return { success: true };
    }),

  testConnection: protectedProcedure
    .input(
      z.object({
        sshKeyId: z.string(),
        ipAddress: z.string(),
        sshPort: z.number().default(22),
        sshUser: z.string().default("root"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const key = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, input.sshKeyId),
      });
      if (!key?.privateKey) throw new Error("SSH key has no private key");
      if (key.userId !== ctx.session.user.id) throw new Error("Access denied");

      const ssh = new SSHExecutor({
        host: input.ipAddress,
        port: input.sshPort,
        username: input.sshUser,
        privateKey: key.privateKey,
      });

      try {
        const ok = await ssh.testConnection();
        await ssh.disconnect();
        return { success: ok, message: ok ? "Connection successful" : "Connection failed" };
      } catch (error: any) {
        await ssh.disconnect();
        return { success: false, message: error.message };
      }
    }),
});
