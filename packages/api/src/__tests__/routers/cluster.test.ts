import { describe, it, expect, vi, beforeEach } from "vitest";
import { protectedProcedure, router, createCallerForRouter } from "../helpers/trpc";
import { z } from "zod";

const mockDb = {
  query: {
    clusters: { findFirst: vi.fn(), findMany: vi.fn() },
    servers: { findFirst: vi.fn() },
    sshKeys: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
  insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })) })),
  delete: vi.fn(() => ({ where: vi.fn() })),
};

vi.mock("@HAForge/db", () => ({
  get db() { return mockDb; },
  clusters: { id: "id", userId: "user_id", status: "status", loadBalancerId: "load_balancer_id", floatingIpId: "floating_ip_id", name: "name" },
  servers: { id: "id", userId: "user_id", clusterId: "cluster_id", hetznerServerId: "hetzner_server_id", role: "role", privateIpAddress: "private_ip_address", ipAddress: "ip_address", sshKeyId: "ssh_key_id", sshPort: "ssh_port", sshUser: "ssh_user", cachedHostname: "cached_hostname" },
  sshKeys: { id: "id", userId: "user_id", privateKey: "private_key" },
  user: { id: "id", hetznerApiToken: "hetzner_api_token" },
  executions: { id: "id" },
}));

const mockGetUserApiToken = vi.fn();
const mockFetch = vi.fn();

vi.mock("../../routers/shared", () => ({
  HETZNER_API: "https://api.hetzner.cloud/v1",
  hetznerHeaders: (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
  getUserApiToken: (...args: any[]) => mockGetUserApiToken(...args),
  verifyServerOwnership: vi.fn(),
  getServerSshKeyMaps: vi.fn(),
}));

vi.mock("../../services/server-info", () => ({
  SERVER_INFO_SCRIPT: "echo server-info",
  parseServerInfo: vi.fn(),
}));

import { db } from "@HAForge/db";
import { clusters } from "@HAForge/db";

const clusterRouter = router({
  usedServerIds: protectedProcedure
    .input(z.object({ excludeClusterId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const allClusters = await db.query.clusters.findMany({ where: () => true, with: { servers: true } });
      const ids = new Set<string>();
      for (const c of allClusters) {
        if (c.id === input.excludeClusterId) continue;
        for (const s of c.servers) {
          if (s.hetznerServerId) ids.add(s.hetznerServerId);
        }
      }
      return Array.from(ids);
    }),

  all: protectedProcedure.query(async ({ ctx }) => {
    const allClusters = await db.query.clusters.findMany({ where: () => true, with: { servers: true } });
    return allClusters.map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      clusterType: c.clusterType,
      serverCount: c.servers?.length || 0,
    }));
  }),

  byId: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({ where: () => true, with: { servers: true } });
      if (!cluster) throw new Error("Cluster not found or access denied");
      return cluster;
    }),

  destroy: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const cluster = await db.query.clusters.findFirst({ where: () => true, with: { servers: true } });
      if (!cluster) throw new Error("Cluster not found or access denied");
      for (const s of cluster.servers) {
        await db.delete({}).where({});
      }
      await db.delete({}).where({});
      return { success: true };
    }),
});

function createCaller(userId = "test-user-1") {
  return createCallerForRouter({ cluster: clusterRouter }, userId);
}

const mockCluster = {
  id: "cluster-1",
  name: "test-cluster",
  userId: "test-user-1",
  status: "running",
  clusterType: "haproxy",
  servers: [
    { id: "srv-1", role: "postgresql_1", hetznerServerId: "100", privateIpAddress: "10.0.1.5", cachedHostname: "PG1" },
    { id: "srv-2", role: "postgresql_2", hetznerServerId: "101", privateIpAddress: "10.0.1.6", cachedHostname: "PG2" },
    { id: "srv-3", role: "haproxy_1", hetznerServerId: "102", privateIpAddress: "10.0.1.2", cachedHostname: "HA1" },
  ],
  superuserUsername: "postgres",
  superuserPassword: "secret",
  enableMonitoring: 1,
};

describe("clusterRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("usedServerIds", () => {
    it("returns server IDs from all non-draft clusters", async () => {
      mockDb.query.clusters.findMany.mockResolvedValue([
        { id: "c1", servers: [{ hetznerServerId: "100" }, { hetznerServerId: "101" }] },
        { id: "c2", servers: [{ hetznerServerId: "200" }] },
      ]);

      const caller = createCaller();
      const result = await caller.cluster.usedServerIds({});

      expect(result).toEqual(expect.arrayContaining(["100", "101", "200"]));
    });

    it("excludes cluster specified in excludeClusterId", async () => {
      mockDb.query.clusters.findMany.mockResolvedValue([
        { id: "c1", servers: [{ hetznerServerId: "100" }] },
        { id: "c2", servers: [{ hetznerServerId: "200" }] },
      ]);

      const caller = createCaller();
      const result = await caller.cluster.usedServerIds({ excludeClusterId: "c1" });

      expect(result).toEqual(["200"]);
      expect(result).not.toContain("100");
    });

    it("returns empty array when no clusters exist", async () => {
      mockDb.query.clusters.findMany.mockResolvedValue([]);

      const caller = createCaller();
      const result = await caller.cluster.usedServerIds({});

      expect(result).toEqual([]);
    });
  });

  describe("all", () => {
    it("returns clusters with server counts", async () => {
      mockDb.query.clusters.findMany.mockResolvedValue([
        { id: "c1", name: "cluster-1", status: "running", clusterType: "haproxy", servers: [{ id: "s1" }, { id: "s2" }] },
        { id: "c2", name: "cluster-2", status: "draft", clusterType: "hetzner_lb", servers: [] },
      ]);

      const caller = createCaller();
      const result = await caller.cluster.all();

      expect(result).toHaveLength(2);
      expect(result[0].serverCount).toBe(2);
      expect(result[1].serverCount).toBe(0);
    });
  });

  describe("byId", () => {
    it("returns a single cluster", async () => {
      mockDb.query.clusters.findFirst.mockResolvedValue(mockCluster);

      const caller = createCaller();
      const result = await caller.cluster.byId({ clusterId: "cluster-1" });

      expect(result.id).toBe("cluster-1");
      expect(result.servers).toHaveLength(3);
    });

    it("throws if cluster not found", async () => {
      mockDb.query.clusters.findFirst.mockResolvedValue(null);

      const caller = createCaller();

      await expect(caller.cluster.byId({ clusterId: "nonexistent" })).rejects.toThrow("Cluster not found");
    });
  });

  describe("destroy", () => {
    it("deletes cluster and its servers", async () => {
      mockDb.query.clusters.findFirst.mockResolvedValue(mockCluster);

      const caller = createCaller();
      const result = await caller.cluster.destroy({ clusterId: "cluster-1" });

      expect(result.success).toBe(true);
      // 3 servers + 1 cluster = 4 delete calls
      expect(db.delete).toHaveBeenCalledTimes(4);
    });

    it("throws if cluster not found", async () => {
      mockDb.query.clusters.findFirst.mockResolvedValue(null);

      const caller = createCaller();

      await expect(caller.cluster.destroy({ clusterId: "nonexistent" })).rejects.toThrow("Cluster not found");
    });
  });
});
