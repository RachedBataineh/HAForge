import { db } from "@HAForge/db";
import { clusters, executions, servers, sshKeys, user } from "@HAForge/db";
import { eq, ne, and } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { SSHExecutor } from "../services/ssh-executor";
import { SERVER_INFO_SCRIPT, parseServerInfo } from "../services/server-info";

const HETZNER_API = "https://api.hetzner.cloud/v1";

async function getUserApiToken(userId: string): Promise<string> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  return u?.hetznerApiToken || "";
}

const hetznerHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

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

async function getServerSshKeyMaps(userId?: string) {
  const dbServerRecords = userId
    ? await db.query.servers.findMany({ where: eq(servers.userId, userId) })
    : await db.query.servers.findMany();
  const sshKeyMap = new Map<string, string | null>();
  const sshPrivateKeyMap = new Map<string, string | null>();
  for (const s of dbServerRecords) {
    if (s.hetznerServerId) {
      sshKeyMap.set(s.hetznerServerId, s.sshKeyId);
    }
  }
  const allSshKeys = userId
    ? await db.query.sshKeys.findMany({ where: eq(sshKeys.userId, userId) })
    : await db.query.sshKeys.findMany();
  const sshKeyNameMap = new Map<string, string>();
  const sshPrivateKeyByName = new Map<string, string | null>();
  for (const k of allSshKeys) {
    sshKeyNameMap.set(k.id, k.name);
  }
  // Resolve private keys
  for (const s of dbServerRecords) {
    if (s.hetznerServerId && s.sshKeyId) {
      const key = allSshKeys.find((k) => k.id === s.sshKeyId);
      if (key?.privateKey) sshPrivateKeyMap.set(s.hetznerServerId, key.privateKey);
    }
  }
  return { sshKeyMap, sshKeyNameMap, sshPrivateKeyMap };
}

export const clusterRouter = router({
  hetznerFloatingIps: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/floating_ips`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return data.floating_ips.map((ip: any) => ({
        id: String(ip.id),
        ip: ip.ip,
        name: ip.name || "",
        type: ip.type,
        homeLocation: ip.home_location?.name || "",
      }));
    }),

  usedServerIds: protectedProcedure
    .input(z.object({ excludeClusterId: z.string().optional() }))
    .query(async ({ input }) => {
      const allClusters = await db.query.clusters.findMany({
        where: ne(clusters.status, "draft"),
        with: { servers: true },
      });
      const ids = new Set<string>();
      for (const c of allClusters) {
        if (c.id === input.excludeClusterId) continue;
        for (const s of c.servers) {
          if (s.hetznerServerId) ids.add(s.hetznerServerId);
        }
      }
      return Array.from(ids);
    }),
  usedLoadBalancerIds: protectedProcedure
    .input(z.object({ excludeClusterId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const allClusters = await db.query.clusters.findMany({
        where: and(
          ne(clusters.status, "draft"),
          eq(clusters.userId, ctx.session.user.id),
        ),
      });
      const ids = new Set<string>();
      for (const c of allClusters) {
        if (c.id === input.excludeClusterId) continue;
        if (c.loadBalancerId) ids.add(c.loadBalancerId);
      }
      return Array.from(ids);
    }),
  usedFloatingIpIds: protectedProcedure
    .input(z.object({ excludeClusterId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const allClusters = await db.query.clusters.findMany({
        where: and(
          ne(clusters.status, "draft"),
          eq(clusters.userId, ctx.session.user.id),
        ),
      });
      const ids = new Set<string>();
      for (const c of allClusters) {
        if (c.id === input.excludeClusterId) continue;
        if (c.floatingIpId) ids.add(c.floatingIpId);
      }
      return Array.from(ids);
    }),

  hetznerServers: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/servers`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();

      const { sshKeyMap, sshKeyNameMap, sshPrivateKeyMap } = await getServerSshKeyMaps(ctx.session.user.id);

      return data.servers.map((srv: any) => {
        const hetznerId = String(srv.id);
        const keyId = sshKeyMap.get(hetznerId) || null;
        return {
          id: hetznerId,
          name: srv.name,
          publicIp: srv.public_net?.ipv4?.ip || "",
          privateIps: (srv.private_net || []).map((net: any) => ({
            networkId: String(net.network),
            ip: net.ip,
          })),
          status: srv.status,
          location: srv.datacenter?.location?.name || "",
          sshKeyId: keyId,
          sshKeyName: keyId ? sshKeyNameMap.get(keyId) || null : null,
          sshPrivateKey: sshPrivateKeyMap.get(hetznerId) || null,
        };
      });
    }),

  hetznerLoadBalancers: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/load_balancers`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return data.load_balancers.map((lb: any) => ({
        id: String(lb.id),
        name: lb.name,
        publicIp: lb.public_net?.ipv4?.ip || "",
        privateIp: lb.private_net?.[0]?.ip || "",
        location: lb.location?.city || lb.location?.name || "",
        type: lb.load_balancer_type?.name || "",
        targets: (lb.targets || []).map((t: any) => ({
          type: t.type,
          serverId: t.server?.id ? String(t.server.id) : null,
          status: t.status,
        })),
        services: (lb.services || []).map((s: any) => ({
          protocol: s.protocol,
          listenPort: s.listen_port,
          destinationPort: s.destination_port,
          healthCheck: s.health_check?.http?.uri || "",
        })),
      }));
    }),

  hetznerCreateLoadBalancer: protectedProcedure
    .input(z.object({
      name: z.string(),
      serverIds: z.array(z.string()).optional(),
      location: z.string().optional(),
      loadBalancerType: z.string().optional(),
      networkId: z.string().optional(),
      algorithm: z.enum(["round_robin", "least_connections"]).optional(),
      service: z.object({
        protocol: z.enum(["tcp", "http", "https"]).default("tcp"),
        listenPort: z.number().default(5432),
        destinationPort: z.number().default(5432),
        healthCheckProtocol: z.enum(["http", "tcp"]).default("http"),
        healthCheckPort: z.number().default(8008),
        healthCheckInterval: z.number().default(5),
        healthCheckTimeout: z.number().default(3),
        healthCheckRetries: z.number().default(3),
        healthCheckPath: z.string().default("/leader"),
        healthCheckStatuses: z.array(z.string()).default(["200"]),
        healthCheckTls: z.boolean().default(false),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const svc = input.service || {
        protocol: "tcp" as const,
        listenPort: 5432,
        destinationPort: 5432,
        healthCheckProtocol: "http" as const,
        healthCheckPort: 8008,
        healthCheckInterval: 5,
        healthCheckTimeout: 3,
        healthCheckRetries: 3,
        healthCheckPath: "/leader",
        healthCheckStatuses: ["200"],
        healthCheckTls: false,
      };
      const body: any = {
        name: input.name,
        load_balancer_type: input.loadBalancerType || "lb11",
        location: input.location || "fsn1",
        algorithm: { type: input.algorithm || "round_robin" },
        targets: (input.serverIds || []).map((id) => ({
          type: "server",
          server: { id: Number(id) },
        })),
        services: [
          {
            protocol: svc.protocol || "tcp",
            listen_port: svc.listenPort || 5432,
            destination_port: svc.destinationPort || 5432,
            proxyprotocol: false,
            health_check: (() => {
              const hc: any = {
                protocol: svc.healthCheckProtocol || "http",
                port: svc.healthCheckPort || 8008,
                interval: svc.healthCheckInterval || 5,
                timeout: svc.healthCheckTimeout || 3,
                retries: svc.healthCheckRetries || 3,
              };
              if ((svc.healthCheckProtocol || "http") === "http") {
                hc.http = {
                  domain: "",
                  path: svc.healthCheckPath || "/leader",
                  response: "",
                  status_codes: svc.healthCheckStatuses || ["200"],
                  tls: svc.healthCheckTls ?? false,
                };
              }
              return hc;
            })(),
          },
        ],
      };
      if (input.networkId) {
        body.network = Number(input.networkId);
      }
      const res = await fetch(`${HETZNER_API}/load_balancers`, {
        method: "POST",
        headers: hetznerHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(`Hetzner API error: ${res.status} - ${err.error?.message || "Unknown error"}`);
      }
      const data = await res.json();
      return {
        id: String(data.load_balancer.id),
        name: data.load_balancer.name,
        publicIp: data.load_balancer.public_net?.ipv4?.ip || "",
      };
    }),

  hetznerLoadBalancerTypes: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/load_balancer_types`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return (data.load_balancer_types || []).map((t: any) => ({
        id: String(t.id),
        name: t.name,
        description: t.description || "",
        maxConnections: t.max_connections || 0,
        maxServices: t.max_services || 0,
        maxTargets: t.max_targets || 0,
        priceMonthly: parseFloat(t.prices?.[0]?.price_monthly?.gross || "0").toFixed(2),
      }));
    }),

  hetznerDeleteLoadBalancer: protectedProcedure
    .input(z.object({ loadBalancerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/load_balancers/${input.loadBalancerId}`, {
        method: "DELETE",
        headers: hetznerHeaders(token),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Delete failed: ${res.status}`);
      }
      return { success: true };
    }),

  hetznerUpdateLoadBalancer: protectedProcedure
    .input(z.object({
      loadBalancerId: z.string(),
      algorithm: z.enum(["round_robin", "least_connections"]).optional(),
      service: z.object({
        protocol: z.enum(["tcp", "http", "https"]),
        listenPort: z.number(),
        destinationPort: z.number(),
        healthCheckProtocol: z.enum(["http", "tcp"]),
        healthCheckPort: z.number(),
        healthCheckInterval: z.number(),
        healthCheckTimeout: z.number(),
        healthCheckRetries: z.number(),
        healthCheckPath: z.string(),
        healthCheckTls: z.boolean(),
        healthCheckStatuses: z.array(z.string()),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      // Update algorithm
      if (input.algorithm) {
        const res = await fetch(`${HETZNER_API}/load_balancers/${input.loadBalancerId}/actions/change_algorithm`, {
          method: "POST",
          headers: hetznerHeaders(token),
          body: JSON.stringify({ type: input.algorithm }),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || `Update algorithm failed: ${res.status}`); }
      }

      // Update service using the update_service action
      if (input.service) {
        const svc = input.service;
        const hc: any = {
          protocol: svc.healthCheckProtocol,
          port: svc.healthCheckPort,
          interval: svc.healthCheckInterval,
          timeout: svc.healthCheckTimeout,
          retries: svc.healthCheckRetries,
        };
        if (svc.healthCheckProtocol === "http") {
          hc.http = {
            domain: "",
            path: svc.healthCheckPath,
            response: "",
            status_codes: svc.healthCheckStatuses,
            tls: svc.healthCheckTls,
          };
        }
        const updateRes = await fetch(`${HETZNER_API}/load_balancers/${input.loadBalancerId}/actions/update_service`, {
          method: "POST",
          headers: hetznerHeaders(token),
          body: JSON.stringify({
            listen_port: svc.listenPort,
            destination_port: svc.destinationPort,
            proxyprotocol: false,
            health_check: hc,
          }),
        });
        if (!updateRes.ok) { const err = await updateRes.json(); throw new Error(err.error?.message || `Update service failed: ${updateRes.status}`); }
      }
      return { success: true };
    }),

  hetznerNetworks: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/networks`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return (data.networks || []).map((n: any) => ({
        id: String(n.id),
        name: n.name,
        ipRange: n.ip_range || "",
        serverCount: n.servers?.length || 0,
      }));
    }),

  hetznerLoadBalancerDetails: protectedProcedure
    .input(z.object({ loadBalancerId: z.string() }))
    .query(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const [lbRes, serversRes] = await Promise.all([
        fetch(`${HETZNER_API}/load_balancers/${input.loadBalancerId}`, { headers: hetznerHeaders(token) }),
        fetch(`${HETZNER_API}/servers`, { headers: hetznerHeaders(token) }),
      ]);
      if (!lbRes.ok) throw new Error(`Hetzner API error: ${lbRes.status}`);
      const data = await lbRes.json();
      const lb = data.load_balancer;

      // Build server name + status map
      const serverNameMap = new Map<string, string>();
      const serverStatusMap = new Map<string, string>();
      const serverIpMap = new Map<string, string>();
      if (serversRes.ok) {
        const serversData = await serversRes.json();
        for (const srv of serversData.servers || []) {
          serverNameMap.set(String(srv.id), srv.name);
          serverStatusMap.set(String(srv.id), srv.status);
          serverIpMap.set(String(srv.id), srv.public_net?.ipv4?.ip || "");
        }
      }

      return {
        id: String(lb.id),
        name: lb.name,
        publicIp: lb.public_net?.ipv4?.ip || "",
        privateIp: lb.private_net?.[0]?.ip || "",
        location: lb.location?.city || lb.location?.name || "",
        type: lb.load_balancer_type?.name || "",
        algorithm: lb.algorithm?.type || "",
        created: lb.created || "",
        labels: lb.labels || {},
        targets: (lb.targets || []).map((t: any) => {
          const serverId = t.server?.id ? String(t.server.id) : null;
          return {
            type: t.type,
            serverId,
            serverName: serverId ? serverNameMap.get(serverId) || null : null,
            serverStatus: serverId ? serverStatusMap.get(serverId) || "unknown" : "unknown",
            serverIp: serverId ? serverIpMap.get(serverId) || "" : "",
            status: typeof t.health_status === "string" ? t.health_status : (Array.isArray(t.health_status) ? t.health_status.map((h: any) => `${h.listen_port}: ${h.status}`).join(", ") : "unknown"),
          };
        }),
        services: (lb.services || []).map((s: any) => ({
          protocol: s.protocol,
          listenPort: s.listen_port,
          destinationPort: s.destination_port,
          healthCheckProtocol: s.health_check?.protocol || "",
          healthCheckPort: s.health_check?.port || 0,
          healthCheckInterval: s.health_check?.interval || 0,
          healthCheckTimeout: s.health_check?.timeout || 0,
          healthCheckRetries: s.health_check?.retries || 0,
          healthCheckPath: s.health_check?.http?.path || "",
          healthCheckTls: s.health_check?.http?.tls || false,
          healthCheckStatuses: s.health_check?.http?.status_codes || [],
        })),
      };
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100), clusterType: z.enum(["haproxy", "hetzner_lb"]).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [cluster] = await db
        .insert(clusters)
        .values({
          name: input.name,
          userId: ctx.session.user.id,
          clusterType: input.clusterType || "haproxy",
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
        floatingIpId: z.string().optional(),
        clusterType: z.enum(["haproxy", "hetzner_lb"]).optional(),
        loadBalancerId: z.string().optional(),
        loadBalancerIp: z.string().optional(),
        wizardStep: z.number().optional(),
        superuserUsername: z.string().optional(),
        adminUsername: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const [cluster] = await db
        .update(clusters)
        .set(data)
        .where(and(eq(clusters.id, id), eq(clusters.userId, ctx.session.user.id)))
        .returning();
      if (!cluster) throw new Error("Cluster not found or access denied");
      return cluster;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.delete(clusters).where(and(eq(clusters.id, input.id), eq(clusters.userId, ctx.session.user.id)));
      if (!result.rowCount) throw new Error("Cluster not found or access denied");
      return { success: true };
    }),

  destroyCluster: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found");

      const token = await getUserApiToken(ctx.session.user.id);
      const results: { resource: string; action: string; status: string; error?: string }[] = [];

      // 1. Delete Hetzner servers
      for (const server of cluster.servers) {
        if (server.hetznerServerId && token) {
          try {
            const res = await fetch(`${HETZNER_API}/servers/${server.hetznerServerId}`, {
              method: "DELETE",
              headers: hetznerHeaders(token),
            });
            if (res.ok) {
              results.push({ resource: `Server ${server.hetznerServerId}`, action: "deleted", status: "ok" });
            } else {
              const err = await res.json().catch(() => ({}));
              results.push({ resource: `Server ${server.hetznerServerId}`, action: "delete", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
            }
          } catch (err: any) {
            results.push({ resource: `Server ${server.hetznerServerId}`, action: "delete", status: "failed", error: err.message });
          }
        }
      }

      // 2. Delete Load Balancer (LB mode)
      if (cluster.loadBalancerId && token) {
        try {
          const res = await fetch(`${HETZNER_API}/load_balancers/${cluster.loadBalancerId}`, {
            method: "DELETE",
            headers: hetznerHeaders(token),
          });
          if (res.ok) {
            results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "deleted", status: "ok" });
          } else {
            const err = await res.json().catch(() => ({}));
            results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "delete", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
          }
        } catch (err: any) {
          results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "delete", status: "failed", error: err.message });
        }
      }

      // 3. Release Floating IP (HAProxy mode)
      if (cluster.floatingIpId && token) {
        try {
          const res = await fetch(`${HETZNER_API}/floating_ips/${cluster.floatingIpId}`, {
            method: "DELETE",
            headers: hetznerHeaders(token),
          });
          if (res.ok) {
            results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "released", status: "ok" });
          } else {
            const err = await res.json().catch(() => ({}));
            results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "release", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
          }
        } catch (err: any) {
          results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "release", status: "failed", error: err.message });
        }
      }

      // 4. Cancel any running execution
      if (token) {
        try {
          const runningExecs = await db.query.executions.findMany({
            where: and(eq(executions.clusterId, cluster.id)),
          });
          for (const exec of runningExecs) {
            if (exec.status === "running") {
              await db.update(executions).set({ status: "cancelled", completedAt: new Date() }).where(eq(executions.id, exec.id));
            }
          }
        } catch {}
      }

      // 5. Delete DB records (cascade handles servers, executions, steps, logs)
      await db.delete(clusters).where(eq(clusters.id, cluster.id));

      return { success: true, results };
    }),

  cleanCluster: protectedProcedure
    .input(z.object({ clusterId: z.string(), image: z.string().default("ubuntu-24.04") }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found");

      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const results: { resource: string; action: string; status: string; error?: string }[] = [];

      // 1. Rebuild all Hetzner servers with fresh OS
      for (const server of cluster.servers) {
        if (server.hetznerServerId) {
          try {
            // Power off first (rebuild requires server to be off or it triggers automatic shutdown)
            await fetch(`${HETZNER_API}/servers/${server.hetznerServerId}/actions/poweroff`, {
              method: "POST",
              headers: hetznerHeaders(token),
            }).catch(() => {});

            // Wait a moment for power off
            await new Promise((r) => setTimeout(r, 3000));

            const res = await fetch(`${HETZNER_API}/servers/${server.hetznerServerId}/actions/rebuild`, {
              method: "POST",
              headers: hetznerHeaders(token),
              body: JSON.stringify({ image: input.image }),
            });
            if (res.ok) {
              results.push({ resource: `Server ${server.hetznerServerId}`, action: "rebuilt with fresh OS", status: "ok" });
            } else {
              const err = await res.json().catch(() => ({}));
              results.push({ resource: `Server ${server.hetznerServerId}`, action: "rebuild", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
            }
          } catch (err: any) {
            results.push({ resource: `Server ${server.hetznerServerId}`, action: "rebuild", status: "failed", error: err.message });
          }
        }
      }

      // 2. Delete LB (LB mode)
      if (cluster.loadBalancerId) {
        try {
          const res = await fetch(`${HETZNER_API}/load_balancers/${cluster.loadBalancerId}`, {
            method: "DELETE",
            headers: hetznerHeaders(token),
          });
          if (res.ok) {
            results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "deleted", status: "ok" });
          } else {
            const err = await res.json().catch(() => ({}));
            results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "delete", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
          }
        } catch (err: any) {
          results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "delete", status: "failed", error: err.message });
        }
      }

      // 3. Release Floating IP (HAProxy mode)
      if (cluster.floatingIpId) {
        try {
          const res = await fetch(`${HETZNER_API}/floating_ips/${cluster.floatingIpId}`, {
            method: "DELETE",
            headers: hetznerHeaders(token),
          });
          if (res.ok) {
            results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "released", status: "ok" });
          } else {
            const err = await res.json().catch(() => ({}));
            results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "release", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
          }
        } catch (err: any) {
          results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "release", status: "failed", error: err.message });
        }
      }

      // 4. Cancel running executions
      try {
        const runningExecs = await db.query.executions.findMany({
          where: and(eq(executions.clusterId, cluster.id)),
        });
        for (const exec of runningExecs) {
          if (exec.status === "running") {
            await db.update(executions).set({ status: "cancelled", completedAt: new Date() }).where(eq(executions.id, exec.id));
          }
        }
      } catch {}

      // 5. Delete DB records (cascade handles servers, executions, steps, logs)
      await db.delete(clusters).where(eq(clusters.id, cluster.id));

      return { success: true, results };
    }),

  serverClusterInfo: protectedProcedure
    .input(z.object({ hetznerServerId: z.string() }))
    .query(async ({ input, ctx }) => {
      const server = await db.query.servers.findFirst({
        where: eq(servers.hetznerServerId, input.hetznerServerId),
        with: { cluster: true },
      });
      if (!server) return null;
      const ownerId = server.userId || server.cluster?.userId;
      if (ownerId && ownerId !== ctx.session.user.id) return null;
      if (!server.cluster) return null;
      return {
        serverId: server.id,
        clusterId: server.cluster.id,
        clusterName: server.cluster.name,
        clusterStatus: server.cluster.status,
        clusterType: server.cluster.clusterType,
        role: server.role,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.id), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found");
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

  allServers: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.query.clusters.findMany({
      where: eq(clusters.userId, ctx.session.user.id),
      with: { servers: true },
    });
    const allServersList: any[] = [];
    for (const cluster of result) {
      for (const server of cluster.servers) {
        allServersList.push({ ...server, clusterId: cluster.id, clusterName: cluster.name, clusterStatus: cluster.status, clusterType: cluster.clusterType });
      }
    }
    // Enrich with Hetzner server names and power status
    const haProxyPausedClusters = new Set<string>();
    try {
      const u = await db.query.user.findFirst({ where: eq(user.id, ctx.session.user.id) });
      const token = u?.hetznerApiToken || "";
      if (token) {
        const hzIds = [...new Set(allServersList.map((s) => s.hetznerServerId).filter(Boolean))];
        if (hzIds.length > 0) {
          const res = await fetch("https://api.hetzner.cloud/v1/servers", { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const data = await res.json();
            const nameMap: Record<string, string> = {};
            const statusMap: Record<string, string> = {};
            for (const s of data.servers || []) {
              nameMap[String(s.id)] = s.name;
              statusMap[String(s.id)] = s.status;
            }
            for (const s of allServersList) {
              if (s.hetznerServerId) {
                if (nameMap[s.hetznerServerId]) s.serverName = nameMap[s.hetznerServerId];
                if (statusMap[s.hetznerServerId]) s.serverStatus = statusMap[s.hetznerServerId];
              }
            }
          }
        }
      }
      // Check HAProxy active status per cluster
      const clusterIds = [...new Set(allServersList.map((s: any) => s.clusterId).filter(Boolean))];
      for (const cid of clusterIds) {
        const haServers = allServersList.filter((s: any) => s.clusterId === cid && s.role?.startsWith("haproxy") && s.ipAddress && s.sshKeyId && s.serverStatus === "running");
        const checkServer = haServers[0];
        if (checkServer) {
          try {
            const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, checkServer.sshKeyId!) });
            if (key?.privateKey) {
              const ssh = new SSHExecutor({ host: checkServer.ipAddress!, port: checkServer.sshPort || 22, username: checkServer.sshUser || "root", privateKey: key.privateKey });
              await ssh.connect();
              try {
                const result = await ssh.exec("systemctl is-active haproxy");
                if (result.stdout?.trim() !== "active") haProxyPausedClusters.add(cid);
              } finally {
                await ssh.disconnect();
              }
            }
          } catch { /* ignore SSH failures */ }
        }
      }
    } catch {}
    for (const s of allServersList) {
      if (haProxyPausedClusters.has(s.clusterId) && s.role?.startsWith("haproxy")) s.haProxyPaused = true;
    }
    return allServersList;
  }),

  allHetznerServers: protectedProcedure.query(async ({ ctx }) => {
    const u = await db.query.user.findFirst({
      where: eq(user.id, ctx.session.user.id),
    });
    const token = u?.hetznerApiToken || "";

    // Collect used Hetzner server IDs from clusters
    const userClusters = await db.query.clusters.findMany({
      where: eq(clusters.userId, ctx.session.user.id),
      with: { servers: true },
    });
    const usedServerIds = new Set<string>();
    for (const c of userClusters) {
      if (c.status === "draft") continue;
      for (const s of c.servers) {
        if (s.hetznerServerId) usedServerIds.add(s.hetznerServerId);
      }
    }

    const { sshKeyMap, sshKeyNameMap, sshPrivateKeyMap } = await getServerSshKeyMaps();

    const allServers: any[] = [];

    if (token) {
      try {
        const res = await fetch("https://api.hetzner.cloud/v1/servers", {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          for (const srv of data.servers || []) {
            const hetznerId = String(srv.id);
            const keyId = sshKeyMap.get(hetznerId) || null;
            allServers.push({
              id: hetznerId,
              name: srv.name,
              publicIp: srv.public_net?.ipv4?.ip || "",
              privateIps: (srv.private_net || []).map((net: any) => net.ip),
              status: srv.status,
              serverType: srv.server_type?.name || "",
              location: srv.datacenter?.location?.name || "",
              created: srv.created || "",
              used: usedServerIds.has(hetznerId),
              sshKeyId: keyId,
              sshKeyName: keyId ? sshKeyNameMap.get(keyId) || null : null,
              sshPrivateKey: sshPrivateKeyMap.get(hetznerId) || null,
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch Hetzner servers:", err);
      }
    }

    return { servers: allServers };
  }),

  hetznerServerTypes: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/server_types`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return data.server_types.map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        cores: t.cores,
        memory: t.memory,
        disk: t.disk,
        architecture: t.architecture || "x86",
        price: parseFloat(t.prices?.[0]?.price_monthly?.gross || "0").toFixed(2),
      }));
    }),

  hetznerLocations: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/locations`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return data.locations.map((l: any) => ({
        id: String(l.id),
        name: l.name,
        description: l.description,
        country: l.country,
        city: l.city,
      }));
    }),

  hetznerImages: protectedProcedure
    .input(z.object({ architecture: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const arch = input.architecture || "x86";
      const res = await fetch(`${HETZNER_API}/images?type=system&per_page=50`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      const seen = new Set<string>();
      return data.images
        .filter((i: any) => i.architecture === arch)
        .filter((i: any) => {
          if (seen.has(i.name)) return false;
          seen.add(i.name);
          return true;
        })
        .map((i: any) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          os: i.os_flavor,
          version: i.os_version,
        }));
    }),

  hetznerCreateServer: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(63),
      serverType: z.string(),
      location: z.string(),
      image: z.string(),
      sshKeyId: z.string().optional(),
      networkId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const body: any = {
        name: input.name,
        server_type: input.serverType,
        location: input.location,
        image: input.image,
        start_after_create: true,
      };
      if (input.sshKeyId) {
        body.ssh_keys = [Number(input.sshKeyId)];
      }
      if (input.networkId) {
        body.networks = [input.networkId];
      }
      const res = await fetch(`${HETZNER_API}/servers`, {
        method: "POST",
        headers: hetznerHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Hetzner API error: ${res.status}`);
      }
      const data = await res.json();
      const srv = data.server;
      return {
        id: String(srv.id),
        name: srv.name,
        publicIp: srv.public_net?.ipv4?.ip || "",
        status: srv.status,
      };
    }),

  hetznerSshKeys: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/ssh_keys`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return data.ssh_keys.map((k: any) => ({
        id: String(k.id),
        name: k.name,
        fingerprint: k.fingerprint,
        publicKey: k.public_key || "",
      }));
    }),

  allHetznerSshKeys: protectedProcedure.query(async ({ ctx }) => {
    const u = await db.query.user.findFirst({
      where: eq(user.id, ctx.session.user.id),
    });
    const token = u?.hetznerApiToken;
    if (!token) {
      // No token saved — just return DB keys
      return await db.query.sshKeys.findMany({
        where: eq(sshKeys.userId, ctx.session.user.id),
        orderBy: (sshKeys, { desc }) => [desc(sshKeys.createdAt)],
      });
    }

    // Sync Hetzner keys into DB
    try {
      const res = await fetch("https://api.hetzner.cloud/v1/ssh_keys", {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        for (const k of data.ssh_keys || []) {
          const hetznerId = String(k.id);

          const existing = await db.query.sshKeys.findFirst({
            where: eq(sshKeys.hetznerKeyId, hetznerId),
          });
          if (!existing) {
            await db.insert(sshKeys).values({
              userId: ctx.session.user.id,
              name: k.name,
              hetznerKeyId: hetznerId,
              publicKey: k.public_key || "",
              privateKey: null,
              fingerprint: k.fingerprint,
            });
          } else if (existing.name !== k.name || existing.fingerprint !== k.fingerprint || existing.publicKey !== (k.public_key || "")) {
            await db.update(sshKeys).set({
              name: k.name,
              fingerprint: k.fingerprint,
              publicKey: k.public_key || "",
            }).where(eq(sshKeys.id, existing.id));
          }
        }
      }
    } catch (err) {
      console.error("Failed to sync Hetzner SSH keys:", err);
    }

    const dbKeys = await db.query.sshKeys.findMany({
      where: eq(sshKeys.userId, ctx.session.user.id),
      orderBy: (sshKeys, { desc }) => [desc(sshKeys.createdAt)],
    });
    return dbKeys;
  }),

  addPrivateKey: protectedProcedure
    .input(z.object({
      keyId: z.string(),
      privateKey: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const key = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, input.keyId),
      });
      if (!key || key.userId !== ctx.session.user.id) {
        throw new Error("SSH key not found");
      }
      await db.update(sshKeys).set({ privateKey: input.privateKey }).where(eq(sshKeys.id, input.keyId));
      return { success: true };
    }),

  hetznerCreateSshKey: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(64),
      publicKey: z.string(),
      privateKey: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/ssh_keys`, {
        method: "POST",
        headers: hetznerHeaders(token),
        body: JSON.stringify({ name: input.name, public_key: input.publicKey }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Hetzner API error: ${res.status}`);
      }
      const data = await res.json();

      // Save to DB with private key
      await db.insert(sshKeys).values({
        userId: ctx.session.user.id,
        name: input.name,
        hetznerKeyId: String(data.ssh_key.id),
        publicKey: input.publicKey,
        privateKey: input.privateKey,
        fingerprint: data.ssh_key.fingerprint,
      }).onConflictDoUpdate({
        target: sshKeys.hetznerKeyId,
        set: { name: input.name, publicKey: input.publicKey, privateKey: input.privateKey, fingerprint: data.ssh_key.fingerprint },
      });

      return {
        id: String(data.ssh_key.id),
        name: data.ssh_key.name,
        fingerprint: data.ssh_key.fingerprint,
      };
    }),

  hetznerDeleteSshKey: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/ssh_keys/${input.keyId}`, {
        method: "DELETE",
        headers: hetznerHeaders(token),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Hetzner API error: ${res.status}`);
      }
      // Delete from DB too
      await db.delete(sshKeys).where(eq(sshKeys.hetznerKeyId, input.keyId));

      return { success: true };
    }),

  serverDetails: protectedProcedure
    .input(z.object({
      serverId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const server = await verifyServerOwnership(input.serverId, ctx.session.user.id);
      const serverWithKey = await db.query.servers.findFirst({
        where: eq(servers.id, server.id),
        with: { sshKey: true },
      });
      if (!serverWithKey) throw new Error("Server not found");
      const privateKey = serverWithKey.sshKey?.privateKey;
      if (!privateKey) throw new Error("No SSH key configured");

      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: serverWithKey.ipAddress || "",
        port: serverWithKey.sshPort || 22,
        username: serverWithKey.sshUser || "root",
        privateKey,
      });
      await ssh.connect();
      try {
        const result = await ssh.exec(SERVER_INFO_SCRIPT);
        if (result.exitCode !== 0) throw new Error(result.stderr);
        const info = parseServerInfo(result.stdout);
        return info;
      } finally {
        await ssh.disconnect();
      }
    }),

  serverSetTimezone: protectedProcedure
    .input(z.object({
      serverId: z.string(),
      timezone: z.string().regex(/^[a-zA-Z0-9_+\-/]+$/),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.serverId, ctx.session.user.id);
      const server = await db.query.servers.findFirst({
        where: eq(servers.id, input.serverId),
        with: { sshKey: true },
      });
      if (!server) throw new Error("Server not found");
      const privateKey = server.sshKey?.privateKey;
      if (!privateKey) throw new Error("No SSH key configured");

      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: server.ipAddress || "",
        port: server.sshPort || 22,
        username: server.sshUser || "root",
        privateKey,
      });
      await ssh.connect();
      try {
        const result = await ssh.exec(`sudo timedatectl set-timezone ${input.timezone}`);
        if (result.exitCode !== 0) throw new Error(result.stderr);
        return { success: true };
      } finally {
        await ssh.disconnect();
      }
    }),

  hetznerServerInfo: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/servers/${input.serverId}`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      const s = data.server;
      return {
        id: String(s.id),
        name: s.name,
        status: s.status,
        serverType: s.server_type?.description || s.server_type?.name || "",
        cores: s.server_type?.cores || 0,
        memory: s.server_type?.memory || 0,
        disk: s.server_type?.disk || 0,
        location: s.datacenter?.location?.city || s.datacenter?.location?.name || "",
        datacenter: s.datacenter?.name || "",
        publicIp: s.public_net?.ipv4?.ip || "",
        privateIps: (s.private_net || []).map((n: any) => n.ip),
        created: s.created || "",
        rescueEnabled: s.rescue_enabled || false,
        backupWindow: s.backup_window || null,
        locked: s.locked || false,
        outgoingTraffic: s.outgoing_traffic || 0,
        ingoingTraffic: s.ingoing_traffic || 0,
        includedTraffic: s.included_traffic || 0,
        labels: s.labels || {},
      };
    }),

  hetznerServerAction: protectedProcedure
    .input(z.object({ serverId: z.string(), action: z.enum(["poweron", "poweroff", "reboot"]) }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/servers/${input.serverId}/actions/${input.action}`, {
        method: "POST",
        headers: hetznerHeaders(token),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Action failed: ${res.status}`);
      }
      return { success: true };
    }),

  sshExec: protectedProcedure
    .input(z.object({
      serverId: z.string(),
      command: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.serverId, ctx.session.user.id);
      const server = await db.query.servers.findFirst({
        where: eq(servers.id, input.serverId),
        with: { sshKey: true },
      });
      if (!server) throw new Error("Server not found");
      const privateKey = server.sshKey?.privateKey;
      if (!privateKey) throw new Error("No SSH key configured");

      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: server.ipAddress || "",
        port: server.sshPort || 22,
        username: server.sshUser || "root",
        privateKey,
      });
      await ssh.connect();
      try {
        const result = await ssh.exec(input.command);
        if (result.exitCode !== 0) throw new Error(result.stderr || `Exit code ${result.exitCode}`);
        return { success: true, stdout: result.stdout, stderr: result.stderr };
      } finally {
        await ssh.disconnect();
      }
    }),

  refreshServerInfo: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.serverId, ctx.session.user.id);
      const server = await db.query.servers.findFirst({
        where: eq(servers.id, input.serverId),
        with: { sshKey: true },
      });
      if (!server) throw new Error("Server not found");
      const privateKey = server.sshKey?.privateKey;
      if (!privateKey) throw new Error("No SSH key configured");

      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: server.ipAddress || "",
        port: server.sshPort || 22,
        username: server.sshUser || "root",
        privateKey,
      });
      await ssh.connect();
      try {
        const result = await ssh.exec(SERVER_INFO_SCRIPT);
        if (result.exitCode !== 0) throw new Error(result.stderr);
        const info = parseServerInfo(result.stdout);

        await db.update(servers).set({
          cachedHostname: info.hostname,
          cachedOs: info.os,
          cachedArch: info.arch,
          cachedCpuCores: Number(info.cpuCores) || null,
          cachedRamMB: Number(info.ramMB) || null,
          cachedKernel: info.kernel,
          cachedUptime: info.uptime,
          cachedTimezone: info.timezone,
          cachedDiskTotal: info.diskTotal || null,
          cachedDiskUsed: info.diskUsed || null,
          cachedDiskFree: info.diskFree || null,
          cachedDiskPercent: info.diskPercent || null,
          lastFetchedAt: new Date(),
        }).where(eq(servers.id, input.serverId));

        return { success: true };
      } finally {
        await ssh.disconnect();
      }
    }),

  updateServerCache: protectedProcedure
    .input(z.object({
      serverId: z.string(),
      timezone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.serverId, ctx.session.user.id);
      await db.update(servers).set({
        ...(input.timezone ? { cachedTimezone: input.timezone } : {}),
        lastFetchedAt: new Date(),
      }).where(eq(servers.id, input.serverId));
      return { success: true };
    }),

  hetznerRebuildServer: protectedProcedure
    .input(z.object({ serverId: z.string(), image: z.string().default("ubuntu-24.04") }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      // Power off first
      await fetch(`${HETZNER_API}/servers/${input.serverId}/actions/poweroff`, {
        method: "POST",
        headers: hetznerHeaders(token),
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
      // Rebuild with fresh image
      const res = await fetch(`${HETZNER_API}/servers/${input.serverId}/actions/rebuild`, {
        method: "POST",
        headers: hetznerHeaders(token),
        body: JSON.stringify({ image: input.image }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Rebuild failed: ${res.status}`);
      }
      // Clear cached info since it's now a fresh OS
      const dbServer = await db.query.servers.findFirst({
        where: eq(servers.hetznerServerId, input.serverId),
      });
      if (dbServer) {
        await db.update(servers).set({
          cachedHostname: null, cachedOs: null, cachedArch: null, cachedCpuCores: null,
          cachedRamMB: null, cachedKernel: null, cachedUptime: null, cachedTimezone: null,
          cachedDiskTotal: null, cachedDiskUsed: null, cachedDiskFree: null, cachedDiskPercent: null,
          lastFetchedAt: null,
        }).where(eq(servers.id, dbServer.id));
      }
      return { success: true };
    }),

  hetznerDeleteServer: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/servers/${input.serverId}`, {
        method: "DELETE",
        headers: hetznerHeaders(token),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Delete failed: ${res.status}`);
      }
      // Also remove from DB if linked
      const dbServer = await db.query.servers.findFirst({
        where: eq(servers.hetznerServerId, input.serverId),
      });
      if (dbServer) {
        await db.delete(servers).where(eq(servers.id, dbServer.id));
      }
      return { success: true };
    }),

  pgNodeRoles: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const u = await db.query.user.findFirst({ where: eq(user.id, ctx.session.user.id) });
      const apiToken = u?.hetznerApiToken || "";

      const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
      const roles: Record<string, "leader" | "replica" | "offline" | "unknown"> = {};
      const serverNames: Record<string, string> = {};
      const serverStatus: Record<string, string> = {};

      // Fetch server names and status from Hetzner API
      if (apiToken) {
        const srvRes = await fetch(`${HETZNER_API}/servers`, {
          headers: hetznerHeaders(apiToken),
        });
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          for (const srv of srvData.servers || []) {
            serverNames[String(srv.id)] = srv.name;
            serverStatus[String(srv.id)] = srv.status;
          }
        }
      }

      if (cluster.clusterType === "hetzner_lb" && cluster.loadBalancerId && apiToken) {
        // LB mode: use health checks to determine leader
        const lbRes = await fetch(`${HETZNER_API}/load_balancers/${cluster.loadBalancerId}`, {
          headers: hetznerHeaders(apiToken),
        });
        if (lbRes.ok) {
          const lbData = await lbRes.json();
          const lb = lbData.load_balancer;
          const targets: any[] = lb.targets || [];
          const healthyIds = new Set<string>();

          for (const t of targets) {
            if (t.type === "server" && t.server?.id) {
              const healthStatuses: any[] = t.health_status || [];
              const isHealthy = healthStatuses.some((h: any) => h.status === "healthy" && h.listen_port === 5432);
              if (isHealthy) healthyIds.add(String(t.server.id));
            }
          }

          // Get server power status
          const srvRes = await fetch(`${HETZNER_API}/servers`, {
            headers: hetznerHeaders(apiToken),
          });
          const serverStatusMap = new Map<string, string>();
          if (srvRes.ok) {
            const srvData = await srvRes.json();
            for (const srv of srvData.servers || []) {
              serverStatusMap.set(String(srv.id), srv.status);
            }
          }

          for (const s of pgServers) {
            if (!s.hetznerServerId) { roles[s.role] = "unknown"; continue; }
            if (healthyIds.has(s.hetznerServerId)) {
              roles[s.role] = "leader";
            } else {
              const srvStatus = serverStatusMap.get(s.hetznerServerId);
              roles[s.role] = srvStatus === "running" ? "replica" : "offline";
            }
          }
        }
      } else if (apiToken) {
        // HAProxy mode: SSH into an online node, run patronictl list, match by private IP
        // First check power status via Hetzner API to skip offline servers
        const srvRes = await fetch(`${HETZNER_API}/servers`, { headers: hetznerHeaders(apiToken) });
        const serverStatusMap = new Map<string, string>();
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          for (const srv of srvData.servers || []) {
            serverStatusMap.set(String(srv.id), srv.status);
          }
        }
        // Mark offline servers
        for (const s of pgServers) {
          if (!s.hetznerServerId) { roles[s.role] = "unknown"; continue; }
          const status = serverStatusMap.get(s.hetznerServerId);
          if (status !== "running") roles[s.role] = "offline";
        }

        // Find an online server to query patronictl from
        let success = false;
        for (const candidate of pgServers) {
          if (roles[candidate.role] === "offline") continue;
          if (!candidate.ipAddress || !candidate.sshKeyId) continue;
          try {
            const { SSHExecutor } = await import("../services/ssh-executor");
            const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, candidate.sshKeyId) });
            if (!key?.privateKey) continue;
            const ssh = new SSHExecutor({ host: candidate.ipAddress, port: candidate.sshPort || 22, username: candidate.sshUser || "root", privateKey: key.privateKey });
            await ssh.connect();
            try {
              const result = await ssh.exec("patronictl -c /etc/patroni/config.yml list --format json 2>/dev/null || echo '[]'");
              const parsed: any[] = JSON.parse(result.stdout || "[]");
              for (const s of pgServers) {
                if (roles[s.role] === "offline") continue;
                if (!s.privateIpAddress) { roles[s.role] = "unknown"; continue; }
                const matched = parsed.find((p: any) => {
                  const host = (p.Host || "").split(":")[0];
                  return host === s.privateIpAddress;
                });
                if (matched) {
                  roles[s.role] = matched.Role?.includes("Leader") ? "leader" : "replica";
                } else {
                  roles[s.role] = "unknown";
                }
              }
              success = true;
            } finally {
              await ssh.disconnect();
            }
            if (success) break;
          } catch (err) {
            console.error(`[pgNodeRoles] Failed to query ${candidate.role}:`, err);
            continue;
          }
        }
        if (!success) {
          for (const s of pgServers) {
            if (!roles[s.role]) roles[s.role] = "unknown";
          }
        }
      }

      // Fetch LB name if applicable
      let lbName: string | null = null;
      if (cluster.clusterType === "hetzner_lb" && cluster.loadBalancerId && apiToken) {
        try {
          const lbRes = await fetch(`${HETZNER_API}/load_balancers/${cluster.loadBalancerId}`, {
            headers: hetznerHeaders(apiToken),
          });
          if (lbRes.ok) {
            const lbData = await lbRes.json();
            lbName = lbData.load_balancer?.name || null;
          }
        } catch (err) { console.error("Failed to fetch LB name:", err); }
      }

      // Check HAProxy service status on HA nodes
      let haProxyActive: boolean | null = null;
      if (cluster.clusterType !== "hetzner_lb") {
        const haServers = cluster.servers.filter((s) => s.role?.startsWith("haproxy"));
        const checkServer = haServers.find((s) => s.ipAddress && s.sshKeyId);
        if (checkServer) {
          try {
            const { SSHExecutor } = await import("../services/ssh-executor");
            const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, checkServer.sshKeyId!) });
            if (key?.privateKey) {
              const ssh = new SSHExecutor({ host: checkServer.ipAddress!, port: checkServer.sshPort || 22, username: checkServer.sshUser || "root", privateKey: key.privateKey });
              await ssh.connect();
              try {
                const result = await ssh.exec("systemctl is-active haproxy");
                haProxyActive = result.stdout?.trim() === "active";
              } finally {
                await ssh.disconnect();
              }
            }
          } catch { haProxyActive = null; }
        }
      }

      return { roles, serverNames, serverStatus, lbName, haProxyActive };
    }),
  toggleHaProxy: protectedProcedure
    .input(z.object({ clusterId: z.string(), action: z.enum(["start", "stop"]) }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");
      if (cluster.clusterType === "hetzner_lb") throw new Error("Not supported for LB mode");

      const haServers = cluster.servers.filter((s) => s.role?.startsWith("haproxy"));
      const results: { server: string; success: boolean; error?: string }[] = [];

      for (const s of haServers) {
        if (!s.ipAddress || !s.sshKeyId) {
          results.push({ server: s.role, success: false, error: "No IP or SSH key" });
          continue;
        }
        try {
          const { SSHExecutor } = await import("../services/ssh-executor");
          const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, s.sshKeyId) });
          if (!key?.privateKey) { results.push({ server: s.role, success: false, error: "No private key" }); continue; }
          const ssh = new SSHExecutor({ host: s.ipAddress, port: s.sshPort || 22, username: s.sshUser || "root", privateKey: key.privateKey });
          await ssh.connect();
          try {
            await ssh.exec(`sudo systemctl ${input.action} haproxy`);
            results.push({ server: s.role, success: true });
          } finally {
            await ssh.disconnect();
          }
        } catch (err: any) {
          results.push({ server: s.role, success: false, error: err.message });
        }
      }
      return { results };
    }),
});
