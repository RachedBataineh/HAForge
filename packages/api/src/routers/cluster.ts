import { db } from "@HAForge/db";
import { clusters, servers, sshKeys, user } from "@HAForge/db";
import { eq, ne } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

async function getServerSshKeyMaps() {
  const dbServerRecords = await db.query.servers.findMany();
  const sshKeyMap = new Map<string, string | null>();
  const sshPrivateKeyMap = new Map<string, string | null>();
  for (const s of dbServerRecords) {
    if (s.hetznerServerId) {
      sshKeyMap.set(s.hetznerServerId, s.sshKeyId);
    }
  }
  const allSshKeys = await db.query.sshKeys.findMany();
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

  hetznerServers: protectedProcedure
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/servers", {
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`Hetzner API error: ${res.status}`);
      }
      const data = await res.json();

      const { sshKeyMap, sshKeyNameMap, sshPrivateKeyMap } = await getServerSshKeyMaps();

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
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/load_balancers", {
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`Hetzner API error: ${res.status}`);
      }
      const data = await res.json();
      return data.load_balancers.map((lb: any) => ({
        id: String(lb.id),
        name: lb.name,
        publicIp: lb.public_net?.ipv4?.ip || "",
        privateIp: lb.private_net?.[0]?.ip || "",
        location: lb.location?.name || "",
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
      apiToken: z.string(),
      name: z.string(),
      serverIds: z.array(z.string()).optional(),
      location: z.string().optional(),
      loadBalancerType: z.string().optional(),
      networkId: z.string().optional(),
      algorithm: z.enum(["round_robin", "least_connections"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const body: any = {
        name: input.name,
        load_balancer_type: input.loadBalancerType || "lb11",
        location: input.location || "fsn1",
        network_zone: "eu-central",
        algorithm: { type: input.algorithm || "round_robin" },
        targets: (input.serverIds || []).map((id) => ({
          type: "server",
          server: { id: Number(id) },
        })),
        services: [
          {
            protocol: "tcp",
            listen_port: 5432,
            destination_port: 5432,
            proxyprotocol: false,
            health_check: {
              protocol: "http",
              port: 8008,
              interval: 5,
              timeout: 3,
              retries: 3,
              http: {
                domain: "",
                path: "/leader",
                response: "",
                statuses: [200],
                tls: true,
              },
            },
          },
        ],
      };
      if (input.networkId) {
        body.network = Number(input.networkId);
      }
      const res = await fetch("https://api.hetzner.cloud/v1/load_balancers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
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
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/load_balancer_types", {
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
      });
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
    .input(z.object({ apiToken: z.string(), loadBalancerId: z.string() }))
    .mutation(async ({ input }) => {
      const res = await fetch(`https://api.hetzner.cloud/v1/load_balancers/${input.loadBalancerId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `Delete failed: ${res.status}`);
      }
      return { success: true };
    }),

  hetznerNetworks: protectedProcedure
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/networks", {
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
      });
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
    .input(z.object({ apiToken: z.string(), loadBalancerId: z.string() }))
    .query(async ({ input }) => {
      const [lbRes, serversRes] = await Promise.all([
        fetch(`https://api.hetzner.cloud/v1/load_balancers/${input.loadBalancerId}`, {
          headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
        }),
        fetch("https://api.hetzner.cloud/v1/servers", {
          headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
        }),
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
        location: lb.location?.name || "",
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
          healthCheckPath: s.health_check?.http?.path || "",
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
      } catch {
        // Skip failed fetch
      }
    }

    return { servers: allServers, apiToken: token };
  }),

  hetznerServerTypes: protectedProcedure
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/server_types", {
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
      });
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
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/locations", {
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return data.locations.map((l: any) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        country: l.country,
        city: l.city,
      }));
    }),

  hetznerImages: protectedProcedure
    .input(z.object({ apiToken: z.string(), architecture: z.string().optional() }))
    .query(async ({ input }) => {
      const arch = input.architecture || "x86";
      const res = await fetch("https://api.hetzner.cloud/v1/images?type=system&per_page=50", {
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
      });
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
      apiToken: z.string(),
      name: z.string(),
      serverType: z.string(),
      location: z.string(),
      image: z.string(),
      sshKeyId: z.string().optional(),
      networkId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
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
      const res = await fetch("https://api.hetzner.cloud/v1/servers", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
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
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/ssh_keys", {
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
      });
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
    } catch {
      // Skip failed fetch
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
      apiToken: z.string(),
      name: z.string(),
      publicKey: z.string(),
      privateKey: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/ssh_keys", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
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
    .input(z.object({ apiToken: z.string(), keyId: z.string() }))
    .mutation(async ({ input }) => {
      const res = await fetch(`https://api.hetzner.cloud/v1/ssh_keys/${input.keyId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
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
    .query(async ({ input }) => {
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
        const script = `echo '---HOSTNAME---' && hostname && echo '---END---'
echo '---OS---' && cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2 && echo '---END---'
echo '---ARCH---' && uname -m && echo '---END---'
echo '---CPU---' && nproc && echo '---END---'
echo '---RAM---' && awk '/MemTotal/ {printf "%.0f", $2/1024}' /proc/meminfo && echo '---END---'
echo '---KERNEL---' && uname -r && echo '---END---'
echo '---UPTIME---' && uptime -p && echo '---END---'
echo '---TIMEZONE---' && timedatectl show -p Timezone --value && echo '---END---'
echo '---DISK---' && df -h / | awk 'NR==2{print $2 "|" $3 "|" $4 "|" $5}' && echo '---END---'`;
        const result = await ssh.exec(script);
        if (result.exitCode !== 0) throw new Error(result.stderr);

        const extract = (tag: string) => {
          const regex = new RegExp(`---${tag}---\\s*\\n([\\s\\S]*?)---END---`);
          const match = result.stdout.match(regex);
          return match ? match[1].trim() : "";
        };

        const diskParts = extract("DISK").split("|");
        return {
          hostname: extract("HOSTNAME"),
          os: extract("OS"),
          arch: extract("ARCH"),
          cpuCores: extract("CPU"),
          ramMB: extract("RAM"),
          kernel: extract("KERNEL"),
          uptime: extract("UPTIME"),
          timezone: extract("TIMEZONE"),
          diskTotal: diskParts[0] || "",
          diskUsed: diskParts[1] || "",
          diskFree: diskParts[2] || "",
          diskPercent: diskParts[3] || "",
        };
      } finally {
        await ssh.disconnect();
      }
    }),

  serverSetTimezone: protectedProcedure
    .input(z.object({
      serverId: z.string(),
      timezone: z.string(),
    }))
    .mutation(async ({ input }) => {
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
    .input(z.object({ apiToken: z.string(), serverId: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch(`https://api.hetzner.cloud/v1/servers/${input.serverId}`, {
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
      });
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
        location: s.datacenter?.location?.name || "",
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
    .input(z.object({ apiToken: z.string(), serverId: z.string(), action: z.enum(["poweron", "poweroff", "reboot"]) }))
    .mutation(async ({ input }) => {
      const res = await fetch(`https://api.hetzner.cloud/v1/servers/${input.serverId}/actions/${input.action}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
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
    .mutation(async ({ input }) => {
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
    .mutation(async ({ input }) => {
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
        const script = [
          "echo '---HOSTNAME---' && hostname && echo '---END---'",
          "echo '---OS---' && cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2 && echo '---END---'",
          "echo '---ARCH---' && uname -m && echo '---END---'",
          "echo '---CPU---' && nproc && echo '---END---'",
          "echo '---RAM---' && awk '/MemTotal/ {printf \"%.0f\", $2/1024}' /proc/meminfo && echo '---END---'",
          "echo '---KERNEL---' && uname -r && echo '---END---'",
          "echo '---UPTIME---' && uptime -p && echo '---END---'",
          "echo '---TIMEZONE---' && timedatectl show -p Timezone --value && echo '---END---'",
          "echo '---DISK---' && df -h / | awk 'NR==2{print $2 \"|\" $3 \"|\" $4 \"|\" $5}' && echo '---END---'",
        ].join("\n");
        const result = await ssh.exec(script);
        if (result.exitCode !== 0) throw new Error(result.stderr);

        const extract = (tag: string) => {
          const regex = new RegExp(`---${tag}---\\s*\\n([\\s\\S]*?)---END---`);
          const match = result.stdout.match(regex);
          return match ? match[1].trim() : "";
        };
        const diskParts = extract("DISK").split("|");

        await db.update(servers).set({
          cachedHostname: extract("HOSTNAME"),
          cachedOs: extract("OS"),
          cachedArch: extract("ARCH"),
          cachedCpuCores: Number(extract("CPU")) || null,
          cachedRamMB: Number(extract("RAM")) || null,
          cachedKernel: extract("KERNEL"),
          cachedUptime: extract("UPTIME"),
          cachedTimezone: extract("TIMEZONE"),
          cachedDiskTotal: diskParts[0] || null,
          cachedDiskUsed: diskParts[1] || null,
          cachedDiskFree: diskParts[2] || null,
          cachedDiskPercent: diskParts[3] || null,
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
    .mutation(async ({ input }) => {
      await db.update(servers).set({
        ...(input.timezone ? { cachedTimezone: input.timezone } : {}),
        lastFetchedAt: new Date(),
      }).where(eq(servers.id, input.serverId));
      return { success: true };
    }),

  pgNodeRoles: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: eq(clusters.id, input.clusterId),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found");

      const u = await db.query.user.findFirst({ where: eq(user.id, ctx.session.user.id) });
      const apiToken = u?.hetznerApiToken || "";

      const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
      const roles: Record<string, "leader" | "replica" | "offline" | "unknown"> = {};
      const serverNames: Record<string, string> = {};

      // Fetch server names from Hetzner API
      if (apiToken) {
        const srvRes = await fetch("https://api.hetzner.cloud/v1/servers", {
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        });
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          for (const srv of srvData.servers || []) {
            serverNames[String(srv.id)] = srv.name;
          }
        }
      }

      if (cluster.clusterType === "hetzner_lb" && cluster.loadBalancerId && apiToken) {
        // LB mode: use health checks to determine leader
        const lbRes = await fetch(`https://api.hetzner.cloud/v1/load_balancers/${cluster.loadBalancerId}`, {
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
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
          const srvRes = await fetch("https://api.hetzner.cloud/v1/servers", {
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
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
        // HAProxy mode: query Patroni REST API on each node
        for (const s of pgServers) {
          if (!s.ipAddress) { roles[s.role] = "unknown"; continue; }
          try {
            // Check server power status first
            if (s.hetznerServerId) {
              const srvRes = await fetch(`https://api.hetzner.cloud/v1/servers/${s.hetznerServerId}`, {
                headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
              });
              if (srvRes.ok) {
                const srvData = await srvRes.json();
                if (srvData.server?.status !== "running") { roles[s.role] = "offline"; continue; }
              }
            }
            const { SSHExecutor } = await import("../services/ssh-executor");
            // Resolve private key
            let privateKey: string | null = null;
            if (s.sshKeyId) {
              const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, s.sshKeyId) });
              privateKey = key?.privateKey || null;
            }
            if (!privateKey) { roles[s.role] = "unknown"; continue; }

            const ssh = new SSHExecutor({ host: s.ipAddress, port: s.sshPort || 22, username: s.sshUser || "root", privateKey });
            await ssh.connect();
            try {
              const result = await ssh.exec("patronictl -c /etc/patroni/config.yml list --format json 2>/dev/null || echo '[]'");
              const parsed = JSON.parse(result.stdout || "[]");
              const me = parsed.find((p: any) => p.Role?.includes("Leader") || p.Role?.includes("Replica") || p.Role?.includes("Standby"));
              if (me) {
                roles[s.role] = me.Role?.includes("Leader") ? "leader" : "replica";
              } else {
                roles[s.role] = "unknown";
              }
            } finally {
              await ssh.disconnect();
            }
          } catch {
            roles[s.role] = "unknown";
          }
        }
      }

      // Fetch LB name if applicable
      let lbName: string | null = null;
      if (cluster.clusterType === "hetzner_lb" && cluster.loadBalancerId && apiToken) {
        try {
          const lbRes = await fetch(`https://api.hetzner.cloud/v1/load_balancers/${cluster.loadBalancerId}`, {
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          });
          if (lbRes.ok) {
            const lbData = await lbRes.json();
            lbName = lbData.load_balancer?.name || null;
          }
        } catch { /* skip */ }
      }

      return { roles, serverNames, lbName };
    }),
});
