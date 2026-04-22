import { db } from "@HAForge/db";
import { servers, sshKeys } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { SSHExecutor } from "../services/ssh-executor";

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
    .mutation(async ({ input }) => {
      const [server] = await db
        .insert(servers)
        .values({
          ...input,
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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
      // Find existing server record by hetznerServerId
      const existing = await db.query.servers.findFirst({
        where: eq(servers.hetznerServerId, input.hetznerServerId),
      });

      if (existing) {
        const updates: any = { sshKeyId: input.sshKeyId };
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
    .query(async ({ input }) => {
      const server = await db.query.servers.findFirst({
        where: eq(servers.hetznerServerId, input.hetznerServerId),
      });
      return server || null;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
      const key = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, input.sshKeyId),
      });
      if (!key?.privateKey) throw new Error("SSH key has no private key");

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
