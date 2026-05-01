import { db } from "@HAForge/db";
import { clusters, executions, servers, sshKeys, user, clusterPatches } from "@HAForge/db";
import { eq, ne, and } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { SERVER_INFO_SCRIPT, parseServerInfo } from "../services/server-info";
import { encrypt, decrypt, isEncrypted } from "../services/crypto";
import { HETZNER_API, hetznerHeaders, getUserApiToken, verifyServerOwnership, getServerSshKeyMaps, decryptPrivateKey } from "./shared";
import { ALL_PATCHES } from "../patches";
import { runPatch } from "../services/patch-runner";

export const clusterRouter = router({
  hetznerFloatingIps: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/floating_ips`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json() as any;
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
    .query(async ({ input, ctx }) => {
      const allClusters = await db.query.clusters.findMany({
        where: and(ne(clusters.status, "draft"), eq(clusters.userId, ctx.session.user.id)),
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
      const data = await res.json() as any;

      const { sshKeyMap, sshKeyNameMap } = await getServerSshKeyMaps(ctx.session.user.id);

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
        };
      });
    }),

  hetznerLoadBalancers: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/load_balancers`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json() as any;
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
        const err = await res.json() as any;
        throw new Error(`Hetzner API error: ${res.status} - ${err.error?.message || "Unknown error"}`);
      }
      const data = await res.json() as any;
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
      const data = await res.json() as any;
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
        const err = await res.json() as any;
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
        if (!res.ok) { const err = await res.json() as any; throw new Error(err.error?.message || `Update algorithm failed: ${res.status}`); }
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
        if (!updateRes.ok) { const err = await updateRes.json() as any; throw new Error(err.error?.message || `Update service failed: ${updateRes.status}`); }
      }
      return { success: true };
    }),

  hetznerNetworks: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/networks`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json() as any;
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
      const data = await lbRes.json() as any;
      const lb = data.load_balancer;

      // Build server name + status map
      const serverNameMap = new Map<string, string>();
      const serverStatusMap = new Map<string, string>();
      const serverIpMap = new Map<string, string>();
      if (serversRes.ok) {
        const serversData = await serversRes.json() as any;
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

  hetznerPricing: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/pricing`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json() as any;
      const fip = data?.pricing?.floating_ip;
      return {
        floatingIpMonthly: parseFloat(fip?.price_monthly?.net || fip?.price_monthly?.gross || "0").toFixed(2),
      };
    }),

  provisionAutomatic: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      clusterType: z.enum(["haproxy", "hetzner_lb"]),
      location: z.string().min(1),
      networkZone: z.string().min(1),
      sshKeyId: z.string().min(1),
      haproxyServerType: z.string().min(1),
      postgresqlServerType: z.string().min(1),
      adminUsername: z.string().default("haforge"),
      superuserUsername: z.string().default("postgres"),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const headers = hetznerHeaders(token);

      // Verify SSH key belongs to user and has a private key
      const key = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, input.sshKeyId),
      });
      if (!key || key.userId !== ctx.session.user.id) throw new Error("SSH key not found or access denied");
      if (!key.privateKey) throw new Error("SSH key must have a private key uploaded for automatic provisioning");
      const hetznerKeyId = key.hetznerKeyId;
      if (!hetznerKeyId) throw new Error("SSH key must be a Hetzner key for automatic provisioning");

      // 1. Create cluster record
      const [cluster] = await db
        .insert(clusters)
        .values({
          name: input.name,
          userId: ctx.session.user.id,
          clusterType: input.clusterType,
          provisioningMode: "automatic",
          status: "draft",
          adminUsername: input.adminUsername,
          superuserUsername: input.superuserUsername,
        })
        .returning();

      if (!cluster) throw new Error("Failed to create cluster record");

      try {
        // 2. Find next available /16 range and create network
        const existingNetsRes = await fetch(`${HETZNER_API}/networks`, { headers });
        if (!existingNetsRes.ok) throw new Error("Failed to fetch existing networks");
        const existingNetsData = await existingNetsRes.json() as any;
        const usedRanges = new Set<string>();
        for (const n of existingNetsData.networks || []) {
          if (n.ip_range) usedRanges.add(n.ip_range);
          for (const s of n.subnets || []) {
            if (s.ip_range) usedRanges.add(s.ip_range);
          }
        }

        // Try 10.0.0.0/16 through 10.255.0.0/16
        let chosenRange = "";
        for (let i = 0; i < 256; i++) {
          const candidate = `10.${i}.0.0/16`;
          if (!usedRanges.has(candidate)) {
            chosenRange = candidate;
            break;
          }
        }
        if (!chosenRange) throw new Error("Could not find an available network range");

        const netRes = await fetch(`${HETZNER_API}/networks`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: `${input.name}-net`,
            ip_range: chosenRange,
            network_zone: input.networkZone,
          }),
        });
        if (!netRes.ok) {
          const err = await netRes.json() as any;
          throw new Error(`Failed to create network: ${err.error?.message || netRes.status}`);
        }
        const netData = await netRes.json() as any;
        const networkId = String(netData.network.id);
        const networkNumId = Number(netData.network.id);

        // Add a subnet to the network (required before attaching servers)
        const subnetRes = await fetch(`${HETZNER_API}/networks/${networkNumId}/actions/add_subnet`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "cloud",
            network_zone: input.networkZone,
            ip_range: chosenRange.replace("/16", "/24"),
          }),
        });
        if (!subnetRes.ok) {
          const err = await subnetRes.json() as any;
          throw new Error(`Failed to create subnet: ${err.error?.message || subnetRes.status}`);
        }

        // 3. Create servers
        const haproxyNames = [
          `${input.name}-haproxy-1`,
          `${input.name}-haproxy-2`,
          `${input.name}-haproxy-3`,
        ];
        const pgNames = [
          `${input.name}-pg-1`,
          `${input.name}-pg-2`,
          `${input.name}-pg-3`,
        ];

        const allServerConfigs = [
          ...haproxyNames.map((name, i) => ({ name, type: input.haproxyServerType, role: `haproxy_${i + 1}` as const })),
          ...pgNames.map((name, i) => ({ name, type: input.postgresqlServerType, role: `postgresql_${i + 1}` as const })),
        ];

        const createdServers: { hetznerId: string; publicIp: string; privateIp: string; role: string; name: string }[] = [];

        for (const cfg of allServerConfigs) {
          const srvRes = await fetch(`${HETZNER_API}/servers`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: cfg.name,
              server_type: cfg.type,
              location: input.location,
              image: "ubuntu-24.04",
              networks: [Number(networkNumId)],
              ssh_keys: [Number(hetznerKeyId)],
              start_after_create: true,
            }),
          });
          if (!srvRes.ok) {
            const err = await srvRes.json() as any;
            throw new Error(`Failed to create server ${cfg.name}: ${err.error?.message || srvRes.status}`);
          }
          const srvData = await srvRes.json() as any;
          const srv = srvData.server;
          createdServers.push({
            hetznerId: String(srv.id),
            publicIp: srv.public_net?.ipv4?.ip || "",
            privateIp: srv.private_net?.[0]?.ip || "",
            role: cfg.role,
            name: cfg.name,
          });
        }

        // 4. Wait for all servers to be running (poll, max 120 seconds)
        const maxWait = 120_000;
        const pollInterval = 5_000;
        const start = Date.now();
        let allRunning = false;

        while (Date.now() - start < maxWait) {
          const checkRes = await fetch(`${HETZNER_API}/servers`, { headers });
          if (checkRes.ok) {
            const checkData = await checkRes.json() as any;
            const serverStatuses = new Map<string, string>();
            for (const s of checkData.servers || []) {
              serverStatuses.set(String(s.id), s.status);
            }
            const statuses = createdServers.map((s) => serverStatuses.get(s.hetznerId) || "unknown");
            if (statuses.every((s) => s === "running")) {
              allRunning = true;
              break;
            }
          }
          await new Promise((r) => setTimeout(r, pollInterval));
        }

        if (!allRunning) {
          throw new Error("Timed out waiting for servers to start. The servers are being created but took too long to become ready.");
        }

        // Refresh private IPs after servers are running (they may have been assigned after boot)
        {
          const refreshRes = await fetch(`${HETZNER_API}/servers`, { headers });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json() as any;
            for (const s of refreshData.servers || []) {
              const match = createdServers.find((cs) => cs.hetznerId === String(s.id));
              if (match) {
                match.publicIp = s.public_net?.ipv4?.ip || match.publicIp;
                match.privateIp = s.private_net?.[0]?.ip || match.privateIp;
              }
            }
          }
        }

        // 5. Create floating IP (HAProxy mode only)
        let floatingIp = "";
        let floatingIpId = "";

        if (input.clusterType === "haproxy") {
          const fipRes = await fetch(`${HETZNER_API}/floating_ips`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              type: "ipv4",
              home_location: input.location,
              description: `${input.name}-floating-ip`,
            }),
          });
          if (!fipRes.ok) {
            const err = await fipRes.json() as any;
            throw new Error(`Failed to create floating IP: ${err.error?.message || fipRes.status}`);
          }
          const fipData = await fipRes.json() as any;
          floatingIpId = String(fipData.floating_ip.id);
          floatingIp = fipData.floating_ip.ip;

          // Assign floating IP to haproxy_1
          const ha1 = createdServers.find((s) => s.role === "haproxy_1");
          if (ha1) {
            const assignRes = await fetch(`${HETZNER_API}/floating_ips/${floatingIpId}/actions/assign`, {
              method: "POST",
              headers,
              body: JSON.stringify({ server: Number(ha1.hetznerId) }),
            });
            if (!assignRes.ok) {
              const err = await assignRes.json() as any;
              throw new Error(`Failed to assign floating IP: ${err.error?.message || assignRes.status}`);
            }
          }
        }

        // 6. Create server records in DB
        for (const srv of createdServers) {
          await db.insert(servers).values({
            clusterId: cluster.id,
            userId: ctx.session.user.id,
            role: srv.role as any,
            hetznerServerId: srv.hetznerId,
            ipAddress: srv.publicIp,
            privateIpAddress: srv.privateIp,
            sshKeyId: input.sshKeyId,
            sshUser: "root",
            sshPort: 22,
            status: "pending",
          });
        }

        // 7. Update cluster with network, floating IP info
        await db.update(clusters).set({
          networkId,
          floatingIp,
          floatingIpId,
          wizardStep: 4,
        }).where(eq(clusters.id, cluster.id));

        // 7.5. Create firewalls
        const pgServerHetznerIds = createdServers
          .filter((s) => s.role.startsWith("postgresql"))
          .map((s) => Number(s.hetznerId));
        const haServerHetznerIds = createdServers
          .filter((s) => s.role.startsWith("haproxy"))
          .map((s) => Number(s.hetznerId));

        // PostgreSQL firewall: only SSH (port 22)
        await fetch(`${HETZNER_API}/firewalls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: `${input.name}-pg-fw`,
            rules: [
              { direction: "in", protocol: "tcp", port: "22", source_ips: ["0.0.0.0/0", "::/0"], destination_ips: [] },
              { direction: "out", protocol: "tcp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
              { direction: "out", protocol: "udp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
              { direction: "out", protocol: "icmp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [] },
            ],
            apply_to: pgServerHetznerIds.map((id) => ({ type: "server", server: { id } })),
          }),
        });

        // HAProxy firewall: SSH (22) + PostgreSQL (5432)
        await fetch(`${HETZNER_API}/firewalls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: `${input.name}-haproxy-fw`,
            rules: [
              { direction: "in", protocol: "tcp", port: "22", source_ips: ["0.0.0.0/0", "::/0"], destination_ips: [] },
              { direction: "in", protocol: "tcp", port: "5432", source_ips: ["0.0.0.0/0", "::/0"], destination_ips: [] },
              { direction: "out", protocol: "tcp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
              { direction: "out", protocol: "udp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
              { direction: "out", protocol: "icmp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [] },
            ],
            apply_to: haServerHetznerIds.map((id) => ({ type: "server", server: { id } })),
          }),
        });

        // 8. Calculate monthly cost
        const [stRes, pricingRes] = await Promise.all([
          fetch(`${HETZNER_API}/server_types`, { headers }),
          fetch(`${HETZNER_API}/pricing`, { headers }),
        ]);
        let monthlyCost = "0.00";
        let fipCost = "0.00";
        let haPrice = "0.00";
        let pgPrice = "0.00";

        if (stRes.ok) {
          const stData = await stRes.json() as any;
          const haType = stData.server_types?.find((t: any) => t.name === input.haproxyServerType);
          const pgType = stData.server_types?.find((t: any) => t.name === input.postgresqlServerType);
          haPrice = parseFloat(haType?.prices?.[0]?.price_monthly?.gross || "0").toFixed(2);
          pgPrice = parseFloat(pgType?.prices?.[0]?.price_monthly?.gross || "0").toFixed(2);
        }
        if (pricingRes.ok) {
          const pData = await pricingRes.json() as any;
          fipCost = parseFloat(pData?.pricing?.floating_ip?.price_monthly?.gross || "0").toFixed(2);
        }

        const haTotal = (parseFloat(haPrice) * 3).toFixed(2);
        const pgTotal = (parseFloat(pgPrice) * 3).toFixed(2);
        const total = (parseFloat(haTotal) + parseFloat(pgTotal) + parseFloat(fipCost)).toFixed(2);
        monthlyCost = total;

        return {
          clusterId: cluster.id,
          servers: createdServers,
          floatingIp,
          floatingIpId,
          networkId,
          monthlyCost,
          costBreakdown: {
            haproxy: { perUnit: haPrice, count: 3, total: haTotal },
            postgresql: { perUnit: pgPrice, count: 3, total: pgTotal },
            floatingIp: fipCost,
            total: monthlyCost,
          },
        };
      } catch (err: any) {
        // On failure, delete the draft cluster (orphaned)
        await db.delete(clusters).where(eq(clusters.id, cluster.id));
        throw err;
      }
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
        enableMonitoring: z.number().optional(),
        networkZone: z.string().optional(),
        applyFirewall: z.number().optional(),
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
              const err = (await res.json().catch(() => ({}))) as any;
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
            const err = (await res.json().catch(() => ({}))) as any;
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
            const err = (await res.json().catch(() => ({}))) as any;
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
              const err = (await res.json().catch(() => ({}))) as any;
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
            const err = (await res.json().catch(() => ({}))) as any;
            results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "delete", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
          }
        } catch (err: any) {
          results.push({ resource: `Load Balancer ${cluster.loadBalancerId}`, action: "delete", status: "failed", error: err.message });
        }
      }

      // 3. Unassign Floating IP (HAProxy mode) — keep it in Hetzner account
      if (cluster.floatingIpId) {
        try {
          const res = await fetch(`${HETZNER_API}/floating_ips/${cluster.floatingIpId}/actions/unassign`, {
            method: "POST",
            headers: hetznerHeaders(token),
          });
          if (res.ok) {
            results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "unassigned (kept in account)", status: "ok" });
          } else {
            const err = (await res.json().catch(() => ({}))) as any;
            results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "unassign", status: "failed", error: err.error?.message || `HTTP ${res.status}` });
          }
        } catch (err: any) {
          results.push({ resource: `Floating IP ${cluster.floatingIp}`, action: "unassign", status: "failed", error: err.message });
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
      // Decrypt passwords for display (encrypted at rest, decrypted for the owner)
      if (cluster.superuserPassword && isEncrypted(cluster.superuserPassword)) {
        cluster.superuserPassword = decrypt(cluster.superuserPassword);
      }
      if (cluster.replicationPassword && isEncrypted(cluster.replicationPassword)) {
        cluster.replicationPassword = decrypt(cluster.replicationPassword);
      }
      return cluster;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.query.clusters.findMany({
      where: eq(clusters.userId, ctx.session.user.id),
      with: { servers: true },
      orderBy: (clusters, { desc }) => [desc(clusters.createdAt)],
    });
    // Strip sensitive fields before sending to client
    return result.map(({ superuserPassword, replicationPassword, ...safe }) => safe);
  }),

  getServerById: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .query(async ({ input, ctx }) => {
      const server = await db.query.servers.findFirst({
        where: eq(servers.id, input.serverId),
        with: { cluster: true, sshKey: true },
      });
      if (!server) return null;
      const ownerId = server.userId || server.cluster?.userId;
      if (ownerId && ownerId !== ctx.session.user.id) return null;

      // Enrich with Hetzner server name/status
      let serverName: string | null = null;
      let serverStatus: string | null = null;
      if (server.hetznerServerId) {
        try {
          const token = await getUserApiToken(ctx.session.user.id);
          if (token) {
            const res = await fetch(`${HETZNER_API}/servers/${server.hetznerServerId}`, { headers: hetznerHeaders(token) });
            if (res.ok) {
              const data = await res.json() as any;
              serverName = data.server?.name || null;
              serverStatus = data.server?.status || null;
            }
          }
        } catch {}
      }

      return {
        ...server,
        clusterName: server.cluster?.name || null,
        clusterStatus: server.cluster?.status || null,
        clusterType: server.cluster?.clusterType || null,
        serverName,
        serverStatus,
        // Strip sensitive SSH key data before sending to client
        sshKey: server.sshKey ? {
          id: server.sshKey.id,
          name: server.sshKey.name,
          fingerprint: server.sshKey.fingerprint,
          hasPrivateKey: !!server.sshKey.privateKey,
        } : null,
        cluster: undefined,
      };
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
    try {
      const u = await db.query.user.findFirst({ where: eq(user.id, ctx.session.user.id) });
      const rawToken = u?.hetznerApiToken || "";
      const token = rawToken ? decrypt(rawToken) : "";
      if (token) {
        const hzIds = [...new Set(allServersList.map((s) => s.hetznerServerId).filter(Boolean))];
        if (hzIds.length > 0) {
          const res = await fetch("https://api.hetzner.cloud/v1/servers", { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const data = await res.json() as any;
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
    } catch {}
    return allServersList;
  }),

  allHetznerServers: protectedProcedure.query(async ({ ctx }) => {
    const u = await db.query.user.findFirst({
      where: eq(user.id, ctx.session.user.id),
    });
    const token = u?.hetznerApiToken ? decrypt(u.hetznerApiToken) : "";
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

    const { sshKeyMap, sshKeyNameMap } = await getServerSshKeyMaps(ctx.session.user.id);

    const allServers: any[] = [];

    if (token) {
      try {
        const res = await fetch("https://api.hetzner.cloud/v1/servers", {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json() as any;
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
            });
          }
        }
      } catch (err: any) {
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
      const data = await res.json() as any;
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
      const data = await res.json() as any;
      return data.locations.map((l: any) => ({
        id: String(l.id),
        name: l.name,
        description: l.description,
        country: l.country,
        city: l.city,
        networkZone: l.network_zone || "",
      }));
    }),

  hetznerNetworkZones: protectedProcedure
    .query(async ({ ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const res = await fetch(`${HETZNER_API}/locations`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json() as any;
      const seen = new Set<string>();
      const zones: { name: string; locationCount: number; locations: string[] }[] = [];
      for (const l of data.locations || []) {
        const z = l.network_zone;
        if (!z || seen.has(z)) continue;
        seen.add(z);
        const locs = data.locations.filter((loc: any) => loc.network_zone === z);
        zones.push({ name: z, locationCount: locs.length, locations: locs.map((loc: any) => loc.name) });
      }
      return zones;
    }),

  prepareInfrastructure: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const headers = hetznerHeaders(token);

      const cluster = await db.query.clusters.findFirst({
        where: eq(clusters.id, input.clusterId),
        with: { servers: true },
      });
      if (!cluster || cluster.userId !== ctx.session.user.id) throw new Error("Cluster not found");
      if (!cluster.networkZone) throw new Error("Network zone not set");

      // 1. Create network if not already created
      let networkId = cluster.networkId;
      let networkNumId = networkId ? Number(networkId) : null;

      if (!networkId) {
        // Find next available /16 range
        const existingNetsRes = await fetch(`${HETZNER_API}/networks`, { headers });
        if (!existingNetsRes.ok) throw new Error("Failed to fetch existing networks");
        const existingNetsData = await existingNetsRes.json() as any;
        const usedRanges = new Set<string>();
        for (const n of existingNetsData.networks || []) {
          if (n.ip_range) usedRanges.add(n.ip_range);
          for (const s of n.subnets || []) {
            if (s.ip_range) usedRanges.add(s.ip_range);
          }
        }

        let chosenRange = "";
        for (let i = 0; i < 256; i++) {
          const candidate = `10.${i}.0.0/16`;
          if (!usedRanges.has(candidate)) {
            chosenRange = candidate;
            break;
          }
        }
        if (!chosenRange) throw new Error("Could not find an available network range");

        const netRes = await fetch(`${HETZNER_API}/networks`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: `${cluster.name}-net`,
            ip_range: chosenRange,
            network_zone: cluster.networkZone,
          }),
        });
        if (!netRes.ok) {
          const err = await netRes.json() as any;
          throw new Error(`Failed to create network: ${err.error?.message || netRes.status}`);
        }
        const netData = await netRes.json() as any;
        networkNumId = Number(netData.network.id);
        networkId = String(networkNumId);

        // Add subnet (required before attaching servers)
        const subnetRes = await fetch(`${HETZNER_API}/networks/${networkNumId}/actions/add_subnet`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "cloud",
            network_zone: cluster.networkZone,
            ip_range: chosenRange.replace("/16", "/24"),
          }),
        });
        if (!subnetRes.ok) {
          const err = await subnetRes.json() as any;
          throw new Error(`Failed to create subnet: ${err.error?.message || subnetRes.status}`);
        }

        await db.update(clusters).set({ networkId }).where(eq(clusters.id, cluster.id));
      }

      // 2. Attach all servers to the network (skip if already attached)
      const srvRes = await fetch(`${HETZNER_API}/servers`, { headers });
      if (!srvRes.ok) throw new Error("Failed to fetch servers");
      const srvData = await srvRes.json() as any;
      const hetznerServers = new Map<string, any>();
      for (const s of srvData.servers || []) {
        hetznerServers.set(String(s.id), s);
      }

      for (const server of cluster.servers) {
        if (!server.hetznerServerId) continue;
        const hSrv = hetznerServers.get(String(server.hetznerServerId));
        if (!hSrv) continue;
        // Check if already on this network
        const alreadyAttached = hSrv.private_net?.some((n: any) => String(n.network) === String(networkNumId));
        if (alreadyAttached) continue;

        const attachRes = await fetch(`${HETZNER_API}/servers/${Number(server.hetznerServerId)}/actions/attach_to_network`, {
          method: "POST",
          headers,
          body: JSON.stringify({ network: networkNumId }),
        });
        if (!attachRes.ok) {
          const err = await attachRes.json() as any;
          console.error(`Failed to attach server ${server.hetznerServerId}: ${err.error?.message}`);
        }
      }

      // 3. Wait for private IPs to be assigned (poll, max 60s)
      const maxWait = 60_000;
      const pollInterval = 5_000;
      const pollStart = Date.now();
      let allHavePrivateIps = false;

      while (Date.now() - pollStart < maxWait) {
        const refreshRes = await fetch(`${HETZNER_API}/servers`, { headers });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json() as any;
          const freshServers = new Map<string, any>();
          for (const s of refreshData.servers || []) {
            freshServers.set(String(s.id), s);
          }

          let allFound = true;
          for (const server of cluster.servers) {
            if (!server.hetznerServerId) continue;
            const hSrv = freshServers.get(String(server.hetznerServerId));
            const privateIp = hSrv?.private_net?.find((n: any) => String(n.network) === String(networkNumId))?.ip;
            if (!privateIp) { allFound = false; break; }
          }

          if (allFound) {
            allHavePrivateIps = true;
            // Update DB records
            for (const server of cluster.servers) {
              if (!server.hetznerServerId) continue;
              const hSrv = freshServers.get(String(server.hetznerServerId));
              const privateIp = hSrv?.private_net?.find((n: any) => String(n.network) === String(networkNumId))?.ip;
              if (privateIp) {
                await db.update(servers).set({ privateIpAddress: privateIp }).where(eq(servers.id, server.id));
              }
            }
            break;
          }
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }

      if (!allHavePrivateIps) {
        throw new Error("Timed out waiting for private IPs to be assigned to servers");
      }

      // 4. Assign floating IP to haproxy_1 (HAProxy mode only)
      if (cluster.floatingIpId && cluster.clusterType === "haproxy") {
        const ha1 = cluster.servers.find((s: any) => s.role === "haproxy_1");
        if (ha1?.hetznerServerId) {
          // Check if already assigned
          const fipRes = await fetch(`${HETZNER_API}/floating_ips/${cluster.floatingIpId}`, { headers });
          if (fipRes.ok) {
            const fipData = await fipRes.json() as any;
            if (!fipData.floating_ip?.server) {
              await fetch(`${HETZNER_API}/floating_ips/${cluster.floatingIpId}/actions/assign`, {
                method: "POST",
                headers,
                body: JSON.stringify({ server: Number(ha1.hetznerServerId) }),
              });
            }
          }
        }
      }

      // 5. Create firewalls if enabled
      if (cluster.applyFirewall !== 0) {
        const pgServers = cluster.servers.filter((s: any) => s.role?.startsWith("postgresql"));
        const haServers = cluster.servers.filter((s: any) => s.role?.startsWith("haproxy"));
        const pgHetznerIds = pgServers.map((s: any) => Number(s.hetznerServerId)).filter(Boolean);
        const haHetznerIds = haServers.map((s: any) => Number(s.hetznerServerId)).filter(Boolean);

        if (pgHetznerIds.length > 0) {
          await fetch(`${HETZNER_API}/firewalls`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: `${cluster.name}-pg-fw`,
              rules: [
                { direction: "in", protocol: "tcp", port: "22", source_ips: ["0.0.0.0/0", "::/0"], destination_ips: [] },
                { direction: "out", protocol: "tcp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
                { direction: "out", protocol: "udp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
                { direction: "out", protocol: "icmp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [] },
              ],
              apply_to: pgHetznerIds.map((id: number) => ({ type: "server", server: { id } })),
            }),
          });
        }

        if (haHetznerIds.length > 0) {
          await fetch(`${HETZNER_API}/firewalls`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: `${cluster.name}-haproxy-fw`,
              rules: [
                { direction: "in", protocol: "tcp", port: "22", source_ips: ["0.0.0.0/0", "::/0"], destination_ips: [] },
                { direction: "in", protocol: "tcp", port: "5432", source_ips: ["0.0.0.0/0", "::/0"], destination_ips: [] },
                { direction: "out", protocol: "tcp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
                { direction: "out", protocol: "udp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [], port: "" },
                { direction: "out", protocol: "icmp", destination_ips: ["0.0.0.0/0", "::/0"], source_ips: [] },
              ],
              apply_to: haHetznerIds.map((id: number) => ({ type: "server", server: { id } })),
            }),
          });
        }
      }

      return { success: true, networkId };
    }),

  hetznerImages: protectedProcedure
    .input(z.object({ architecture: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const token = await getUserApiToken(ctx.session.user.id);
      if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
      const arch = input.architecture || "x86";
      const res = await fetch(`${HETZNER_API}/images?type=system&per_page=50`, { headers: hetznerHeaders(token) });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json() as any;
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
        const err = (await res.json().catch(() => ({}))) as any;
        throw new Error(err.error?.message || `Hetzner API error: ${res.status}`);
      }
      const data = await res.json() as any;
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
      const data = await res.json() as any;
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
    const rawToken = u?.hetznerApiToken;
    const token = rawToken ? decrypt(rawToken) : "";
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
        const data = await res.json() as any;
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
    } catch (err: any) {
      console.error("Failed to sync Hetzner SSH keys:", err);
    }

    const dbKeys = await db.query.sshKeys.findMany({
      where: eq(sshKeys.userId, ctx.session.user.id),
      orderBy: (sshKeys, { desc }) => [desc(sshKeys.createdAt)],
    });
    // Decrypt private keys before returning (user needs to view/copy them)
    return dbKeys.map((k) => ({
      ...k,
      privateKey: k.privateKey ? decryptPrivateKey(k.privateKey) : null,
    }));
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
      await db.update(sshKeys).set({ privateKey: encrypt(input.privateKey) }).where(eq(sshKeys.id, input.keyId));
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
        const err = (await res.json().catch(() => ({}))) as any;
        throw new Error(err.error?.message || `Hetzner API error: ${res.status}`);
      }
      const data = await res.json() as any;

      // Save to DB with private key
      await db.insert(sshKeys).values({
        userId: ctx.session.user.id,
        name: input.name,
        hetznerKeyId: String(data.ssh_key.id),
        publicKey: input.publicKey,
        privateKey: input.privateKey ? encrypt(input.privateKey) : null,
        fingerprint: data.ssh_key.fingerprint,
      }).onConflictDoUpdate({
        target: sshKeys.hetznerKeyId,
        set: { name: input.name, publicKey: input.publicKey, privateKey: input.privateKey ? encrypt(input.privateKey) : null, fingerprint: data.ssh_key.fingerprint },
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
        const err = (await res.json().catch(() => ({}))) as any;
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
      const privateKey = decryptPrivateKey(serverWithKey.sshKey?.privateKey);
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
      const privateKey = decryptPrivateKey(server.sshKey?.privateKey);
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
      const data = await res.json() as any;
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
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Action failed: ${res.status}`);
      }
      return { success: true };
    }),

  // REMOVED: sshExec endpoint was an unrestricted RCE vector.
  // Use the WebSocket terminal (/ws/terminal) for interactive server access.

  refreshServerInfo: protectedProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.serverId, ctx.session.user.id);
      const server = await db.query.servers.findFirst({
        where: eq(servers.id, input.serverId),
        with: { sshKey: true },
      });
      if (!server) throw new Error("Server not found");
      const privateKey = decryptPrivateKey(server.sshKey?.privateKey);
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
        const err = (await res.json().catch(() => ({}))) as any;
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
        const err = (await res.json().catch(() => ({}))) as any;
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
      const apiToken = u?.hetznerApiToken ? decrypt(u.hetznerApiToken) : "";

      const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
      const roles: Record<string, "leader" | "replica" | "offline" | "unknown"> = {};
      const serverNames: Record<string, string> = {};
      const serverStatus: Record<string, string> = {};

      // Fetch server names and power status from Hetzner API
      if (apiToken) {
        const srvRes = await fetch(`${HETZNER_API}/servers`, {
          headers: hetznerHeaders(apiToken),
        });
        if (srvRes.ok) {
          const srvData = await srvRes.json() as any;
          for (const srv of srvData.servers || []) {
            serverNames[String(srv.id)] = srv.name;
            serverStatus[String(srv.id)] = srv.status;
          }
        }
      }

      // Determine PG roles using Patroni REST API /leader endpoint on each node.
      // SSH into one online PG node, then curl each PG node's Patroni REST API.
      // 200 = leader, anything else = replica. Simple and reliable.
      const onlineServers = pgServers.filter((s) => {
        if (!s.ipAddress || !s.sshKeyId) return false;
        if (s.hetznerServerId) return serverStatus[s.hetznerServerId] === "running";
        return true;
      });

      // Mark offline servers
      for (const s of pgServers) {
        if (!s.ipAddress || !s.sshKeyId) { roles[s.role] = "unknown"; continue; }
        if (s.hetznerServerId && serverStatus[s.hetznerServerId] !== "running") {
          roles[s.role] = "offline";
        }
      }

      let ssh: any = null;
      try {
        // Find an online server to SSH into
        for (const candidate of onlineServers) {
          if (roles[candidate.role] === "offline") continue;
          try {
            const { SSHExecutor } = await import("../services/ssh-executor");
            const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, candidate.sshKeyId!) });
            if (!key?.privateKey) continue;
            ssh = new SSHExecutor({ host: candidate.ipAddress!, port: candidate.sshPort || 22, username: candidate.sshUser || "root", privateKey: decryptPrivateKey(key.privateKey)! });
            await ssh.connect();
            break;
          } catch { continue; }
        }

        if (ssh) {
          // Query each PG node's Patroni REST API /leader endpoint
          for (const s of pgServers) {
            if (roles[s.role]) continue; // already marked offline
            if (!s.privateIpAddress) { roles[s.role] = "unknown"; continue; }

            try {
              const result = await ssh.exec(
                `curl -sk https://${s.privateIpAddress}:8008/leader -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 2>/dev/null || echo '000'`,
              );
              const code = (result.stdout || "").trim();
              roles[s.role] = code === "200" ? "leader" : "replica";
            } catch {
              roles[s.role] = "unknown";
            }
          }
        } else {
          // Could not SSH into any server
          for (const s of pgServers) {
            if (!roles[s.role]) roles[s.role] = "unknown";
          }
        }
      } finally {
        if (ssh) await ssh.disconnect().catch(() => {});
      }

      // Fetch LB name if applicable
      let lbName: string | null = null;
      if (cluster.clusterType === "hetzner_lb" && cluster.loadBalancerId && apiToken) {
        try {
          const lbRes = await fetch(`${HETZNER_API}/load_balancers/${cluster.loadBalancerId}`, {
            headers: hetznerHeaders(apiToken),
          });
          if (lbRes.ok) {
            const lbData = await lbRes.json() as any;
            lbName = lbData.load_balancer?.name || null;
          }
        } catch (err: any) { console.error("Failed to fetch LB name:", err); }
      }

      // Check HAProxy service status on HA nodes
      let haProxyActive: boolean | null = null;
      if (cluster.clusterType !== "hetzner_lb") {
        const haServers = cluster.servers.filter((s) => s.role?.startsWith("haproxy"));
        const checkServer = haServers.find((s) => s.ipAddress && s.sshKeyId);
        if (checkServer) {
          let haSsh: any = null;
          try {
            const { SSHExecutor } = await import("../services/ssh-executor");
            const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, checkServer.sshKeyId!) });
            if (key?.privateKey) {
              haSsh = new SSHExecutor({ host: checkServer.ipAddress!, port: checkServer.sshPort || 22, username: checkServer.sshUser || "root", privateKey: decryptPrivateKey(key.privateKey)! });
              await haSsh.connect();
              const result = await haSsh.exec("systemctl is-active haproxy");
              haProxyActive = result.stdout?.trim() === "active";
            }
          } catch { haProxyActive = null; }
          finally { if (haSsh) await haSsh.disconnect().catch(() => {}); }
        }
      }

      return { roles, serverNames, serverStatus, lbName, haProxyActive };
    }),

  getPrometheusConfig: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const allServers = cluster.servers.filter((s) => s.privateIpAddress);
      const roleInfo: Record<string, string> = {
        postgresql_1: "PG Node 1",
        postgresql_2: "PG Node 2",
        postgresql_3: "PG Node 3",
        haproxy_1: "HAProxy Node 1",
        haproxy_2: "HAProxy Node 2",
        haproxy_3: "HAProxy Node 3",
      };

      const nodeTargets = allServers.map((s) => `            - '${s.privateIpAddress}:9100'  # ${roleInfo[s.role] || s.role}`);
      const pgServers = allServers.filter((s) => s.role?.startsWith("postgresql"));
      const pgTargets = pgServers.map((s) => `            - '${s.privateIpAddress}:9187'  # ${roleInfo[s.role] || s.role}`);
      const patroniTargets = pgServers.map((s) => `            - '${s.privateIpAddress}:8008'  # ${roleInfo[s.role] || s.role}`);

      const jobName = `haforge-${cluster.name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}`;

      const config = `scrape_configs:
  - job_name: '${jobName}-node'
    scrape_interval: 15s
    static_configs:
      - targets:
${nodeTargets.join("\n")}
  - job_name: '${jobName}-postgres'
    scrape_interval: 15s
    static_configs:
      - targets:
${pgTargets.join("\n")}
  - job_name: '${jobName}-patroni'
    scrape_interval: 15s
    static_configs:
      - targets:
${patroniTargets.join("\n")}
`;
      return { config };
    }),

  installNodeExporter: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const results: { server: string; success: boolean; error?: string }[] = [];
      const { getMonitoringSteps } = await import("../templates/monitoring/node-exporter-steps");
      const monitoringSteps = getMonitoringSteps();

      for (const server of cluster.servers) {
        if (!server.ipAddress || !server.sshKeyId) {
          results.push({ server: server.role, success: false, error: "No IP or SSH key" });
          continue;
        }
        try {
          const { SSHExecutor } = await import("../services/ssh-executor");
          const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, server.sshKeyId) });
          if (!key?.privateKey) { results.push({ server: server.role, success: false, error: "No private key" }); continue; }
          const ssh = new SSHExecutor({ host: server.ipAddress, port: server.sshPort || 22, username: server.sshUser || "root", privateKey: decryptPrivateKey(key.privateKey)! });
          await ssh.connect();
          try {
            await ssh.exec("sudo systemctl stop node_exporter 2>/dev/null || true");

            // Execute each monitoring step
            let stepError: string | null = null;
            for (const step of monitoringSteps) {
              if (stepError) break;
              // Run commands
              for (const cmdGroup of step.commands) {
                for (const cmd of cmdGroup.commands) {
                  const resolved = cmd.replace(/\$\{(\w+)\}/g, (_m, key: string) => {
                    const vars: Record<string, string> = {};
                    return vars[key] || "";
                  });
                  const result = await ssh.exec(`sudo bash -c '${resolved.replace(/'/g, "'\\''")}'`);
                  if (result.exitCode !== 0 && result.exitCode !== null) {
                    stepError = `Step "${step.name}" failed: ${result.stderr || result.stdout || "Unknown error"}`;
                    break;
                  }
                }
              }
              // Upload files
              for (const file of step.files) {
                await ssh.exec(`sudo tee ${file.path} > /dev/null << 'NODEEXPORTER_EOF'\n${file.content}NODEEXPORTER_EOF`);
                if (file.permissions) await ssh.exec(`sudo chmod ${file.permissions} ${file.path}`);
                if (file.owner) await ssh.exec(`sudo chown ${file.owner} ${file.path}`);
              }
              // Run validation
              if (step.validation && !stepError) {
                const vResult = await ssh.exec(`sudo bash -c '${step.validation}'`);
                if (vResult.stdout?.trim() === "FAILED") {
                  stepError = `Step "${step.name}" validation failed`;
                }
              }
            }
            if (stepError) {
              results.push({ server: server.role, success: false, error: stepError });
            } else {
              results.push({ server: server.role, success: true });
            }
          } finally {
            await ssh.disconnect();
          }
        } catch (err: any) {
          results.push({ server: server.role, success: false, error: err.message });
        }
      }

      return { results };
    }),

  installPgExporter: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const pgServers = cluster.servers.filter((s) => s.role?.startsWith("postgresql"));
      const { getPgExporterSteps } = await import("../templates/monitoring/pg-exporter-steps");
      const pgExporterSteps = getPgExporterSteps();

      const results: { server: string; success: boolean; error?: string }[] = [];

      for (const server of pgServers) {
        if (!server.ipAddress || !server.sshKeyId) {
          results.push({ server: server.role, success: false, error: "No IP or SSH key" });
          continue;
        }
        try {
          const { SSHExecutor } = await import("../services/ssh-executor");
          const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, server.sshKeyId) });
          if (!key?.privateKey) { results.push({ server: server.role, success: false, error: "No private key" }); continue; }
          const ssh = new SSHExecutor({ host: server.ipAddress, port: server.sshPort || 22, username: server.sshUser || "root", privateKey: decryptPrivateKey(key.privateKey)! });
          await ssh.connect();
          try {
            await ssh.exec("sudo systemctl stop postgres_exporter 2>/dev/null || true");

            let stepError: string | null = null;
            for (const step of pgExporterSteps) {
              if (stepError) break;
              for (const cmdGroup of step.commands) {
                for (const cmd of cmdGroup.commands) {
                  const resolved = cmd.replace(/\$\{(\w+)\}/g, (_m, key: string) => {
                    const vars: Record<string, string> = {};
                    return vars[key] || "";
                  });
                  const result = await ssh.exec(`sudo bash -c '${resolved.replace(/'/g, "'\\''")}'`);
                  if (result.exitCode !== 0 && result.exitCode !== null) {
                    stepError = `Step "${step.name}" failed: ${result.stderr || result.stdout || "Unknown error"}`;
                    break;
                  }
                }
              }
              for (const file of step.files) {
                await ssh.exec(`sudo tee ${file.path} > /dev/null << 'PGEXPORTER_EOF'\n${file.content}PGEXPORTER_EOF`);
                if (file.permissions) await ssh.exec(`sudo chmod ${file.permissions} ${file.path}`);
                if (file.owner) await ssh.exec(`sudo chown ${file.owner} ${file.path}`);
              }
              if (step.validation && !stepError) {
                const vResult = await ssh.exec(`sudo bash -c '${step.validation}'`);
                if (vResult.stdout?.trim() === "FAILED") {
                  stepError = `Step "${step.name}" validation failed`;
                }
              }
            }
            if (stepError) {
              results.push({ server: server.role, success: false, error: stepError });
            } else {
              results.push({ server: server.role, success: true });
            }
          } finally {
            await ssh.disconnect();
          }
        } catch (err: any) {
          results.push({ server: server.role, success: false, error: err.message });
        }
      }

      return { results };
    }),

  getMonitoringStatus: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
        with: { servers: true },
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const status: Record<string, { nodeExporter: "active" | "inactive" | "unreachable"; pgExporter: "active" | "inactive" | "unreachable" }> = {};

      for (const server of cluster.servers) {
        if (!server.ipAddress || !server.sshKeyId) {
          status[server.role] = { nodeExporter: "unreachable", pgExporter: "unreachable" };
          continue;
        }
        try {
          const { SSHExecutor } = await import("../services/ssh-executor");
          const key = await db.query.sshKeys.findFirst({ where: eq(sshKeys.id, server.sshKeyId) });
          if (!key?.privateKey) { status[server.role] = { nodeExporter: "unreachable", pgExporter: "unreachable" }; continue; }
          const ssh = new SSHExecutor({ host: server.ipAddress, port: server.sshPort || 22, username: server.sshUser || "root", privateKey: decryptPrivateKey(key.privateKey)! });
          await ssh.connect();
          try {
            const nodeResult = await ssh.exec("systemctl is-active node_exporter 2>/dev/null || echo 'inactive'");
            const nodeExporter: "active" | "inactive" = nodeResult.stdout?.trim() === "active" ? "active" : "inactive";
            const isPg = server.role?.startsWith("postgresql");
            let pgExporter: "active" | "inactive" = "inactive";
            if (isPg) {
              const pgResult = await ssh.exec("systemctl is-active postgres_exporter 2>/dev/null || echo 'inactive'");
              pgExporter = pgResult.stdout?.trim() === "active" ? "active" : "inactive";
            }
            status[server.role] = { nodeExporter, pgExporter };
          } finally {
            await ssh.disconnect();
          }
        } catch {
          status[server.role] = { nodeExporter: "unreachable", pgExporter: "unreachable" };
        }
      }

      return { status, enabled: !!cluster.enableMonitoring };
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
          const ssh = new SSHExecutor({ host: s.ipAddress, port: s.sshPort || 22, username: s.sshUser || "root", privateKey: decryptPrivateKey(key.privateKey)! });
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

  getAvailablePatches: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const applied = await db.query.clusterPatches.findMany({
        where: and(
          eq(clusterPatches.clusterId, input.clusterId),
          eq(clusterPatches.status, "applied"),
        ),
        columns: { patchId: true },
      });
      const appliedIds = new Set(applied.map((p) => p.patchId));

      return ALL_PATCHES
        .filter((p) => !appliedIds.has(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          phase: p.phase,
          hasMultipleSteps: !!(p.steps && p.steps.length > 0),
          discoverLeader: p.discoverLeader || false,
        }));
    }),

  getAppliedPatches: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      return db.query.clusterPatches.findMany({
        where: eq(clusterPatches.clusterId, input.clusterId),
        orderBy: (p, { desc }) => [desc(p.createdAt)],
      });
    }),

  applyPatch: protectedProcedure
    .input(z.object({ clusterId: z.string(), patchId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const patch = ALL_PATCHES.find((p) => p.id === input.patchId);
      if (!patch) throw new Error("Patch not found");

      // Check not already applied
      const existing = await db.query.clusterPatches.findFirst({
        where: and(
          eq(clusterPatches.clusterId, input.clusterId),
          eq(clusterPatches.patchId, input.patchId),
          eq(clusterPatches.status, "applied"),
        ),
      });
      if (existing) throw new Error("Patch already applied");

      const executionId = await runPatch(input.clusterId, patch);
      return { executionId, patchId: input.patchId };
    }),

  applyAllPatches: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({
        where: and(eq(clusters.id, input.clusterId), eq(clusters.userId, ctx.session.user.id)),
      });
      if (!cluster) throw new Error("Cluster not found or access denied");

      const applied = await db.query.clusterPatches.findMany({
        where: and(
          eq(clusterPatches.clusterId, input.clusterId),
          eq(clusterPatches.status, "applied"),
        ),
        columns: { patchId: true },
      });
      const appliedIds = new Set(applied.map((p) => p.patchId));
      const toApply = ALL_PATCHES.filter((p) => !appliedIds.has(p.id));

      if (toApply.length === 0) return { patches: [], firstExecutionId: null };

      // Apply patches sequentially, return the first executionId for the terminal
      const results: { patchId: string; executionId: string }[] = [];
      let firstExecutionId: string | null = null;

      for (const patch of toApply) {
        const executionId = await runPatch(input.clusterId, patch);
        results.push({ patchId: patch.id, executionId });
        if (!firstExecutionId) firstExecutionId = executionId;
      }

      return { patches: results, firstExecutionId };
    }),
});

