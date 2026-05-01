import { protectedProcedure, router } from "../index";
import { z } from "zod";
import { HETZNER_API as API, hetznerHeaders as headers, getUserApiToken } from "./shared";

export const floatingIpRouter = router({
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const [ipRes, srvRes] = await Promise.all([
        fetch(`${API}/floating_ips`, { headers: headers(token) }),
        fetch(`${API}/servers`, { headers: headers(token) }),
      ]);
      if (!ipRes.ok) throw new Error(`Hetzner API error: ${ipRes.status}`);
      const ipData = await ipRes.json() as any;
      const srvData = (srvRes.ok ? await srvRes.json() : { servers: [] }) as any;
      const srvMap = new Map<string, string>();
      for (const s of srvData.servers || []) srvMap.set(String(s.id), s.name);

      return (ipData.floating_ips || []).map((ip: any) => ({
        id: String(ip.id),
        ip: ip.ip,
        type: ip.type,
        name: ip.name || "",
        description: ip.description || "",
        serverId: ip.server ? String(ip.server) : null,
        serverName: ip.server ? srvMap.get(String(ip.server)) || null : null,
        homeLocation: ip.home_location?.name || "",
        homeLocationCity: ip.home_location?.city || "",
        homeLocationCountry: ip.home_location?.country || "",
        blocked: ip.blocked || false,
        protection: ip.protection?.delete || false,
        dnsPtr: (ip.dns_ptr || []).map((d: any) => ({ ip: d.ip, ptr: d.dns_ptr })),
        labels: ip.labels || {},
        created: ip.created || "",
      }));
    }),

  details: protectedProcedure
    .input(z.object({ floatingIpId: z.string() }))
    .query(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const [ipRes, srvRes] = await Promise.all([
        fetch(`${API}/floating_ips/${input.floatingIpId}`, { headers: headers(token) }),
        fetch(`${API}/servers`, { headers: headers(token) }),
      ]);
      if (!ipRes.ok) throw new Error(`Hetzner API error: ${ipRes.status}`);
      const ip = ((await ipRes.json()) as any).floating_ip;
      const srvData = (srvRes.ok ? await srvRes.json() : { servers: [] }) as any;

      const allServers = srvData.servers.map((s: any) => ({
        id: String(s.id),
        name: s.name,
        publicIp: s.public_net?.ipv4?.ip || "",
        status: s.status,
      }));

      return {
        id: String(ip.id),
        ip: ip.ip,
        type: ip.type,
        name: ip.name || "",
        description: ip.description || "",
        serverId: ip.server ? String(ip.server) : null,
        serverName: ip.server ? allServers.find((s: any) => s.id === String(ip.server))?.name || null : null,
        homeLocation: ip.home_location?.name || "",
        homeLocationCity: ip.home_location?.city || "",
        homeLocationCountry: ip.home_location?.country || "",
        blocked: ip.blocked || false,
        protection: ip.protection?.delete || false,
        dnsPtr: (ip.dns_ptr || []).map((d: any) => ({ ip: d.ip, ptr: d.dns_ptr })),
        labels: ip.labels || {},
        created: ip.created || "",
        allServers,
      };
    }),

  pricing: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/pricing`, { headers: headers(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json() as any;
      const fip = data?.pricing?.floating_ip;
      return {
        ipv4: parseFloat(fip?.price_monthly?.net || fip?.price_monthly?.gross || "0").toFixed(2),
        ipv6: "0.00",
      };
    }),

  create: protectedProcedure
    .input(z.object({
      type: z.enum(["ipv4", "ipv6"]).default("ipv4"),
      homeLocation: z.string().min(1),
      name: z.string().optional(),
      description: z.string().optional(),
      serverId: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const body: any = {
        type: input.type,
        home_location: input.homeLocation,
      };
      if (input.description) body.description = input.description;
      if (input.name) body.name = input.name;
      if (input.serverId) body.server = Number(input.serverId);
      const res = await fetch(`${API}/floating_ips`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Create failed: ${res.status}`);
      }
      const data = await res.json() as any;
      return { id: String(data.floating_ip.id), ip: data.floating_ip.ip };
    }),

  delete: protectedProcedure
    .input(z.object({ floatingIpId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/floating_ips/${input.floatingIpId}`, {
        method: "DELETE",
        headers: headers(token),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Delete failed: ${res.status}`);
      }
      return { success: true };
    }),

  assign: protectedProcedure
    .input(z.object({ floatingIpId: z.string(), serverId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/floating_ips/${input.floatingIpId}/actions/assign`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ server: Number(input.serverId) }),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Assign failed: ${res.status}`);
      }
      return { success: true };
    }),

  unassign: protectedProcedure
    .input(z.object({ floatingIpId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/floating_ips/${input.floatingIpId}/actions/unassign`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Unassign failed: ${res.status}`);
      }
      return { success: true };
    }),

  changeReverseDns: protectedProcedure
    .input(z.object({ floatingIpId: z.string(), ip: z.string(), dnsPtr: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${API}/floating_ips/${input.floatingIpId}/actions/change_dns_ptr`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ ip: input.ip, dns_ptr: input.dnsPtr }),
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Change DNS failed: ${res.status}`);
      }
      return { success: true };
    }),
});
