import { db } from "@HAForge/db";
import { clusters } from "@HAForge/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

export const clusterRouter = router({
  hetznerFloatingIps: protectedProcedure
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/floating_ips", {
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`Hetzner API error: ${res.status}`);
      }
      const data = await res.json();
      return data.floating_ips.map((ip: any) => ({
        id: String(ip.id),
        ip: ip.ip,
        name: ip.name || "",
        type: ip.type,
        homeLocation: ip.home_location?.name || "",
      }));
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const [cluster] = await db
        .insert(clusters)
        .values({
          name: input.name,
          userId: ctx.session.user.id,
          status: "draft",
        })
        .returning();
      return cluster;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        floatingIp: z.string().optional(),
        hetznerApiToken: z.string().optional(),
        floatingIpId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const [cluster] = await db
        .update(clusters)
        .set(data)
        .where(eq(clusters.id, id))
        .returning();
      return cluster;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(clusters).where(eq(clusters.id, input.id));
      return { success: true };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const cluster = await db.query.clusters.findFirst({
        where: eq(clusters.id, input.id),
        with: { servers: true },
      });
      return cluster;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.query.clusters.findMany({
      where: eq(clusters.userId, ctx.session.user.id),
      with: { servers: true },
      orderBy: (clusters, { desc }) => [desc(clusters.createdAt)],
    });
    return result;
  }),
});
