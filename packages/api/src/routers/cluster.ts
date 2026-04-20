import { db } from "@HAForge/db";
import { clusters, servers } from "@HAForge/db";
import { eq, ne } from "drizzle-orm";
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
      return data.servers.map((srv: any) => ({
        id: String(srv.id),
        name: srv.name,
        publicIp: srv.public_net?.ipv4?.ip || "",
        privateIps: (srv.private_net || []).map((net: any) => ({
          networkId: String(net.network),
          ip: net.ip,
        })),
        status: srv.status,
        location: srv.datacenter?.location?.name || "",
      }));
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
      serverIds: z.array(z.string()),
      location: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/load_balancers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: input.name,
          load_balancer_type: "lb11",
          location: input.location || "fsn1",
          network_zone: "eu-central",
          targets: input.serverIds.map((id) => ({
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
        }),
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
        hetznerApiToken: z.string().optional(),
        floatingIpId: z.string().optional(),
        clusterType: z.enum(["haproxy", "hetzner_lb"]).optional(),
        loadBalancerId: z.string().optional(),
        loadBalancerIp: z.string().optional(),
        wizardStep: z.number().optional(),
        superuserUsername: z.string().optional(),
        initialDatabase: z.string().optional(),
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
    const servers: any[] = [];
    for (const cluster of result) {
      for (const server of cluster.servers) {
        servers.push({ ...server, clusterId: cluster.id, clusterName: cluster.name, clusterStatus: cluster.status, clusterHetznerToken: cluster.hetznerApiToken || "", clusterType: cluster.clusterType });
      }
    }
    return servers;
  }),

  allHetznerServers: protectedProcedure.query(async ({ ctx }) => {
    // Get all unique API tokens from user's clusters
    const userClusters = await db.query.clusters.findMany({
      where: eq(clusters.userId, ctx.session.user.id),
      with: { servers: true },
    });

    // Collect used Hetzner server IDs
    const usedServerIds = new Set<string>();
    for (const c of userClusters) {
      if (c.status === "draft") continue;
      for (const s of c.servers) {
        if (s.hetznerServerId) usedServerIds.add(s.hetznerServerId);
      }
    }

    // Fetch from all unique tokens
    const tokens = [...new Set(userClusters.map((c) => c.hetznerApiToken).filter(Boolean))];
    const allServers: any[] = [];

    for (const token of tokens) {
      try {
        const res = await fetch("https://api.hetzner.cloud/v1/servers", {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const srv of data.servers || []) {
          const hetznerId = String(srv.id);
          if (allServers.find((s) => s.id === hetznerId)) continue; // deduplicate
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
          });
        }
      } catch {
        // Skip failed token
      }
    }

    return { servers: allServers, apiToken: tokens[0] || "" };
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
    .input(z.object({ apiToken: z.string() }))
    .query(async ({ input }) => {
      const res = await fetch("https://api.hetzner.cloud/v1/images?type=system&per_page=50", {
        headers: { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
      const data = await res.json();
      return data.images.map((i: any) => ({
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
      }));
    }),

  serverDetails: protectedProcedure
    .input(z.object({
      ipAddress: z.string(),
      sshPort: z.number(),
      sshUser: z.string(),
      sshPrivateKey: z.string(),
    }))
    .query(async ({ input }) => {
      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: input.ipAddress,
        port: input.sshPort,
        username: input.sshUser,
        privateKey: input.sshPrivateKey,
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
      ipAddress: z.string(),
      sshPort: z.number(),
      sshUser: z.string(),
      sshPrivateKey: z.string(),
      timezone: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: input.ipAddress,
        port: input.sshPort,
        username: input.sshUser,
        privateKey: input.sshPrivateKey,
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
      host: z.string(),
      port: z.number(),
      username: z.string(),
      privateKey: z.string(),
      command: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: input.host,
        port: input.port,
        username: input.username,
        privateKey: input.privateKey,
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
        with: { cluster: true },
      });
      if (!server) throw new Error("Server not found");
      if (!server.sshPrivateKey) throw new Error("No SSH key configured");

      const { SSHExecutor } = await import("../services/ssh-executor");
      const ssh = new SSHExecutor({
        host: server.ipAddress,
        port: server.sshPort || 22,
        username: server.sshUser || "root",
        privateKey: server.sshPrivateKey,
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
});
