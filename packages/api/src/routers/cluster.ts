import { db } from "@HAForge/db";
import { clusters } from "@HAForge/db";
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
        servers.push({ ...server, clusterId: cluster.id, clusterName: cluster.name, clusterStatus: cluster.status });
      }
    }
    return servers;
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
});
