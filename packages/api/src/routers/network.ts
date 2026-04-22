import { protectedProcedure } from "../index";
import { z } from "zod";
import { router } from "../index";

const API = "https://api.hetzner.cloud/v1";
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export const networkRouter = router({
  list: protectedProcedure
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const [netRes, srvRes] = await Promise.all([
        fetch(`${API}/networks`, { headers: headers(input.apiToken) }),
        fetch(`${API}/servers`, { headers: headers(input.apiToken) }),
      ]);
      if (!netRes.ok) throw new Error(`Hetzner API error: ${netRes.status}`);
      const netData = await netRes.json();
      const srvData = srvRes.ok ? await srvRes.json() : { servers: [] };
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
    .input(z.object({ apiToken: z.string(), networkId: z.string() }))
    .query(async ({ input }) => {
      const [netRes, srvRes] = await Promise.all([
        fetch(`${API}/networks/${input.networkId}`, { headers: headers(input.apiToken) }),
        fetch(`${API}/servers`, { headers: headers(input.apiToken) }),
      ]);
      if (!netRes.ok) throw new Error(`Hetzner API error: ${netRes.status}`);
      const n = (await netRes.json()).network;
      const srvData = srvRes.ok ? await srvRes.json() : { servers: [] };
      const srvMap = new Map<string, any>();
      for (const s of srvData.servers || []) {
        srvMap.set(String(s.id), { name: s.name, status: s.status, publicIp: s.public_net?.ipv4?.ip || "" });
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
          return { id: String(id), name: s?.name || String(id), status: s?.status || "unknown", publicIp: s?.publicIp || "" };
        }),
        loadBalancers: (n.load_balancers || []),
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
      apiToken: z.string(),
      name: z.string().min(1),
      ipRange: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const res = await fetch(`${API}/networks`, {
        method: "POST",
        headers: headers(input.apiToken),
        body: JSON.stringify({ name: input.name, ip_range: input.ipRange }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Create failed: ${res.status}`);
      }
      const data = await res.json();
      return { id: String(data.network.id), name: data.network.name };
    }),

  delete: protectedProcedure
    .input(z.object({ apiToken: z.string(), networkId: z.string() }))
    .mutation(async ({ input }) => {
      const res = await fetch(`${API}/networks/${input.networkId}`, {
        method: "DELETE",
        headers: headers(input.apiToken),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Delete failed: ${res.status}`);
      }
      return { success: true };
    }),
});
