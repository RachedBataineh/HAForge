import { db } from "@HAForge/db";
import { servers } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { SSHExecutor } from "../services/ssh-executor";

export const serverRouter = router({
  add: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        hostname: z.string().optional(),
        ipAddress: z.string().min(1),
        sshPort: z.number().default(22),
        sshUser: z.string().default("root"),
        sshPrivateKey: z.string().min(1),
        role: z.enum([
          "postgresql_1",
          "postgresql_2",
          "postgresql_3",
          "haproxy_1",
          "haproxy_2",
          "haproxy_3",
        ]),
        hetznerServerId: z.string().optional(),
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
        sshPrivateKey: z.string().optional(),
        hetznerServerId: z.string().optional(),
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

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(servers).where(eq(servers.id, input.id));
      return { success: true };
    }),

  testConnection: protectedProcedure
    .input(
      z.object({
        ipAddress: z.string(),
        sshPort: z.number().default(22),
        sshUser: z.string().default("root"),
        sshPrivateKey: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const ssh = new SSHExecutor({
        host: input.ipAddress,
        port: input.sshPort,
        username: input.sshUser,
        privateKey: input.sshPrivateKey,
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
