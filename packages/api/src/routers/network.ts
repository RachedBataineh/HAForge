import { protectedProcedure, router } from "../index";
import { z } from "zod";
import { HETZNER_API as API, hetznerHeaders as headers, getUserApiToken } from "./shared";

export const networkRouter = router({
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const [netRes, srvRes] = await Promise.all([
        fetch(`${API}/networks`, { headers: headers(token) }),
        fetch(`${API}/servers`, { headers: headers(token) }),
      ]);
      if (!netRes.ok) throw new Error(`Hetzner API error: ${netRes.status}`);
      const netData = await netRes.json() as any;
      const srvData = (srvRes.ok ? await srvRes.json() : { servers: [] }) as any;
      const srvMap = new Map<string, string>();
      for (const s of srvData.servers || []) srvMap.set(String(s.id), s.name);

      return (netData.networks || []).map((n: any) => ({
        id: String(n.id),
        name: n.name,
        ipRange: n.ip_range || "",
        created: n.created || "",
        protection: n.protection?.delete || false,
        serverCount: n.servers?.length || 0,
        serverNames: (n.servers || []).map((id: any) => srvMap.get(String(id)) || String(id)),
        loadBalancerCount: n.load_balancers?.length || 0,
        subnets: (n.subnets || []).map((s: any) => ({
          type: s.type,
          ipRange: s.ip_range,
          gateway: s.gateway,
          networkZone: s.network_zone,
        })),
        routes: (n.routes || []).map((r: any) => ({
          destination: r.destination,
          gateway: r.gateway,
        })),
      }));
    }),

  details: protectedProcedure
    .input(z.object({ networkId: z.string() }))
    .query(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const [netRes, srvRes, lbRes] = await Promise.all([
        fetch(`${API}/networks/${input.networkId}`, { headers: headers(token) }),
        fetch(`${API}/servers`, { headers: headers(token) }),
        fetch(`${API}/load_balancers`, { headers: headers(token) }),
      ]);
      if (!netRes.ok) throw new Error(`Hetzner API error: ${netRes.status}`);
      const n = ((await netRes.json()) as any).network;
      const srvData = (srvRes.ok ? await srvRes.json() : { servers: [] }) as any;
      const lbData = (lbRes.ok ? await lbRes.json() : { load_balancers: [] }) as any;

      const srvMap = new Map<string, any>();
      for (const s of srvData.servers || []) {
        const privateNet = (s.private_net || []).find((p: any) => String(p.network) === input.networkId);
        srvMap.set(String(s.id), {
          name: s.name,
          status: s.status,
          publicIp: s.public_net?.ipv4?.ip || "",
          privateIp: privateNet?.ip || "",
          attached: s.private_net?.some((p: any) => String(p.network) === input.networkId) || false,
        });
      }

      const lbMap = new Map<string, any>();
      for (const lb of lbData.load_balancers || []) {
        const privateNet = (lb.private_net || []).find((p: any) => String(p.network) === input.networkId);
        lbMap.set(String(lb.id), {
          name: lb.name,
          publicIp: lb.public_net?.ipv4?.ip || "",
          privateIp: privateNet?.ip || "",
          attached: lb.private_net?.some((p: any) => String(p.network) === input.networkId) || false,
        });
      }

      return {
        id: String(n.id),
        name: n.name,
        ipRange: n.ip_range || "",
        created: n.created || "",
        protection: n.protection?.delete || false,
        labels: n.labels || {},
        exposeRoutesToVswitch: n.expose_routes_to_vswitch || false,
        servers: (n.servers || []).map((id: any) => {
          const s = srvMap.get(String(id));
          return { id: String(id), name: s?.name || String(id), status: s?.status || "unknown", publicIp: s?.publicIp || "", privateIp: s?.privateIp || "" };
        }),
        loadBalancers: (n.load_balancers || []).map((id: any) => {
          const lb = lbMap.get(String(id));
          return { id: String(id), name: lb?.name || `LB ${id}`, publicIp: lb?.publicIp || "", privateIp: lb?.privateIp || "" };
        }),
        allServers: [...srvMap.entries()].map(([id, s]) => ({ id, ...s })),
        allLoadBalancers: [...lbMap.entries()].map(([id, lb]) => ({ id, ...lb })),
        subnets: (n.subnets || []).map((s: any) => ({
          type: s.type,
          ipRange: s.ip_range,
          gateway: s.gateway,
          networkZone: s.network_zone,
        })),
        routes: (n.routes || []).map((r: any) => ({
          destination: r.destination,
          gateway: r.gateway,
        })),
      };
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(64),
      ipRange: z.string().min(1),
      networkZone: z.string().default("eu-central"),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/networks`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          name: input.name,
          ip_range: input.ipRange,
          network_zone: input.networkZone,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Create failed: ${res.status}`);
      }
      const data = await res.json() as any;
      return { id: String(data.network.id), name: data.network.name };
    }),

  delete: protectedProcedure
    .input(z.object({ networkId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/networks/${input.networkId}`, {
        method: "DELETE",
        headers: headers(token),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Delete failed: ${res.status}`);
      }
      return { success: true };
    }),

  addSubnet: protectedProcedure
    .input(z.object({
      networkId: z.string(),
      type: z.enum(["cloud", "server"]).default("cloud"),
      networkZone: z.string().default("eu-central"),
      ipRange: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/networks/${input.networkId}/actions/add_subnet`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          type: input.type,
          network_zone: input.networkZone,
          ip_range: input.ipRange,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Add subnet failed: ${res.status}`);
      }
      return { success: true };
    }),

  deleteSubnet: protectedProcedure
    .input(z.object({ networkId: z.string(), ipRange: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/networks/${input.networkId}/actions/delete_subnet`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ ip_range: input.ipRange }),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Delete subnet failed: ${res.status}`);
      }
      return { success: true };
    }),

  attachServer: protectedProcedure
    .input(z.object({
      networkId: z.string(),
      serverId: z.string(),
      ip: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const body: any = { network: Number(input.networkId) };
      if (input.ip) body.ip = input.ip;
      const res = await fetch(`${API}/servers/${input.serverId}/actions/attach_to_network`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Attach server failed: ${res.status}`);
      }
      return { success: true };
    }),

  detachServer: protectedProcedure
    .input(z.object({ networkId: z.string(), serverId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/servers/${input.serverId}/actions/detach_from_network`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ network: Number(input.networkId) }),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Detach server failed: ${res.status}`);
      }
      return { success: true };
    }),

  attachLoadBalancer: protectedProcedure
    .input(z.object({ networkId: z.string(), loadBalancerId: z.string(), ip: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const body: any = { network: Number(input.networkId) };
      if (input.ip) body.ip = input.ip;
      const res = await fetch(`${API}/load_balancers/${input.loadBalancerId}/actions/attach_to_network`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Attach LB failed: ${res.status}`);
      }
      return { success: true };
    }),

  detachLoadBalancer: protectedProcedure
    .input(z.object({ networkId: z.string(), loadBalancerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/load_balancers/${input.loadBalancerId}/actions/detach_from_network`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ network: Number(input.networkId) }),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Detach LB failed: ${res.status}`);
      }
      return { success: true };
    }),
});
