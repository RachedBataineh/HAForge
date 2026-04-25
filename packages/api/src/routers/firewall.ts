import { protectedProcedure } from "../index";
import { z } from "zod";
import { router } from "../index";
import { db } from "@HAForge/db";
import { user } from "@HAForge/db";
import { eq } from "drizzle-orm";

const API = "https://api.hetzner.cloud/v1";
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

async function getUserApiToken(userId: string): Promise<string> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  return u?.hetznerApiToken || "";
}

export const firewallRouter = router({
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/firewalls`, { headers: headers(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return (data.firewalls || []).map((fw: any) => ({
        id: String(fw.id),
        name: fw.name || "",
        rulesCount: (fw.rules || []).length,
        appliedToCount: (fw.applied_to || []).length,
        labels: fw.labels || {},
        created: fw.created || "",
      }));
    }),

  details: protectedProcedure
    .input(z.object({ firewallId: z.string() }))
    .query(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const [fwRes, srvRes] = await Promise.all([
        fetch(`${API}/firewalls/${input.firewallId}`, { headers: headers(token) }),
        fetch(`${API}/servers`, { headers: headers(token) }),
      ]);
      if (!fwRes.ok) throw new Error(`Hetzner API error: ${fwRes.status}`);
      const fw = (await fwRes.json()).firewall;
      const srvData = srvRes.ok ? await srvRes.json() : { servers: [] };

      const srvMap = new Map<string, any>();
      for (const s of srvData.servers || []) srvMap.set(String(s.id), s);

      const appliedServers: any[] = [];
      for (const app of fw.applied_to || []) {
        if (app.type === "server") {
          const srv = srvMap.get(String(app.server?.id));
          appliedServers.push({
            id: String(app.server?.id),
            name: srv?.name || `Server ${app.server?.id}`,
            publicIp: srv?.public_net?.ipv4?.ip || "",
            status: srv?.status || "unknown",
          });
        }
      }

      const inboundRules = (fw.rules || [])
        .filter((r: any) => r.direction === "in")
        .map((r: any) => ({
          protocol: r.protocol,
          port: r.port || "",
          sourceIps: r.source_ips || [],
          description: r.description || "",
        }));

      const outboundRules = (fw.rules || [])
        .filter((r: any) => r.direction === "out")
        .map((r: any) => ({
          protocol: r.protocol,
          port: r.port || "",
          destinationIps: r.destination_ips || [],
          description: r.description || "",
        }));

      return {
        id: String(fw.id),
        name: fw.name || "",
        labels: fw.labels || {},
        created: fw.created || "",
        inboundRules,
        outboundRules,
        appliedServers,
        allServers: srvData.servers?.map((s: any) => ({
          id: String(s.id),
          name: s.name,
          publicIp: s.public_net?.ipv4?.ip || "",
          status: s.status,
        })) || [],
      };
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      rules: z.array(z.object({
        direction: z.enum(["in", "out"]),
        protocol: z.enum(["tcp", "udp", "icmp", "esp", "gre"]),
        port: z.string().optional(),
        source_ips: z.array(z.string()).optional(),
        destination_ips: z.array(z.string()).optional(),
        description: z.string().optional(),
      })).optional(),
      applyToServerIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const body: any = {
        name: input.name,
        rules: (input.rules || []).map((r) => ({
          direction: r.direction,
          protocol: r.protocol,
          ...(r.port ? { port: r.port } : {}),
          ...(r.source_ips ? { source_ips: r.source_ips } : {}),
          ...(r.destination_ips ? { destination_ips: r.destination_ips } : {}),
          ...(r.description ? { description: r.description } : {}),
        })),
      };
      if (input.applyToServerIds?.length) {
        body.apply_to = input.applyToServerIds.map((id) => ({
          type: "server",
          server: { id: Number(id) },
        }));
      }
      const res = await fetch(`${API}/firewalls`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Create failed: ${res.status}`);
      }
      const data = await res.json();
      return { id: String(data.firewall.id) };
    }),

  update: protectedProcedure
    .input(z.object({
      firewallId: z.string(),
      name: z.string().optional(),
      rules: z.array(z.object({
        direction: z.enum(["in", "out"]),
        protocol: z.enum(["tcp", "udp", "icmp", "esp", "gre"]),
        port: z.string().optional(),
        source_ips: z.array(z.string()).optional(),
        destination_ips: z.array(z.string()).optional(),
        description: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const body: any = {};
      if (input.name) body.name = input.name;
      if (input.rules) {
        body.rules = input.rules.map((r) => ({
          direction: r.direction,
          protocol: r.protocol,
          ...(r.port ? { port: r.port } : {}),
          ...(r.source_ips ? { source_ips: r.source_ips } : {}),
          ...(r.destination_ips ? { destination_ips: r.destination_ips } : {}),
          ...(r.description ? { description: r.description } : {}),
        }));
      }
      const res = await fetch(`${API}/firewalls/${input.firewallId}`, {
        method: "PUT",
        headers: headers(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Update failed: ${res.status}`);
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ firewallId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/firewalls/${input.firewallId}`, {
        method: "DELETE",
        headers: headers(token),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Delete failed: ${res.status}`);
      }
      return { success: true };
    }),

  applyToResources: protectedProcedure
    .input(z.object({
      firewallId: z.string(),
      serverIds: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/firewalls/${input.firewallId}/actions/apply_to_resources`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          apply_to: input.serverIds.map((id) => ({
            type: "server",
            server: { id: Number(id) },
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Apply failed: ${res.status}`);
      }
      return { success: true };
    }),

  removeFromResources: protectedProcedure
    .input(z.object({
      firewallId: z.string(),
      serverIds: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/firewalls/${input.firewallId}/actions/remove_from_resources`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          remove_from: input.serverIds.map((id) => ({
            type: "server",
            server: { id: Number(id) },
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Remove failed: ${res.status}`);
      }
      return { success: true };
    }),
});
