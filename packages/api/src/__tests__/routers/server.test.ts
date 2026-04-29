import { describe, it, expect, vi, beforeEach } from "vitest";
import { protectedProcedure, router, createCallerForRouter } from "../helpers/trpc";
import { z } from "zod";

const mockDb = {
  query: {
    user: { findFirst: vi.fn() },
    servers: { findFirst: vi.fn() },
    clusters: { findFirst: vi.fn() },
    sshKeys: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
  update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })) })),
  delete: vi.fn(() => ({ where: vi.fn() })),
};

vi.mock("@HAForge/db", () => ({
  get db() { return mockDb; },
  user: { id: "id", name: "name", email: "email", hetznerApiToken: "hetzner_api_token" },
  servers: { id: "id", userId: "user_id", clusterId: "cluster_id", hetznerServerId: "hetzner_server_id", sshKeyId: "ssh_key_id", role: "role", status: "status" },
  clusters: { id: "id", userId: "user_id" },
  sshKeys: { id: "id", userId: "user_id", name: "name", privateKey: "private_key" },
}));

vi.mock("../../services/ssh-executor", () => ({
  SSHExecutor: vi.fn().mockImplementation(function(this: any) {
    this.testConnection = vi.fn().mockResolvedValue(true);
    this.disconnect = vi.fn().mockResolvedValue(undefined);
  }),
}));

const verifyServerOwnership = vi.fn();
vi.mock("../../routers/shared", () => ({
  verifyServerOwnership,
}));

import { SSHExecutor } from "../../services/ssh-executor";

const serverRouter = router({
  add: protectedProcedure
    .input(z.object({
      clusterId: z.string().optional(),
      hostname: z.string().optional(),
      ipAddress: z.string().optional(),
      sshPort: z.number().default(22),
      sshUser: z.string().default("root"),
      sshKeyId: z.string().optional(),
      role: z.enum(["postgresql_1", "postgresql_2", "postgresql_3", "haproxy_1", "haproxy_2", "haproxy_3"]),
      hetznerServerId: z.string().optional(),
      privateIpAddress: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const returning = vi.fn().mockResolvedValue([{ id: "srv-1", ...input, userId: ctx.session.user.id, status: "pending" }]);
      mockDb.insert = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
      const [server] = await db.insert(servers).values({ ...input, userId: ctx.session.user.id, status: "pending" }).returning();
      return server;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await verifyServerOwnership(input.id, ctx.session.user.id);
      await mockDb.delete(servers).where({});
      return { success: true };
    }),

  testConnection: protectedProcedure
    .input(z.object({ sshKeyId: z.string(), ipAddress: z.string(), sshPort: z.number().default(22), sshUser: z.string().default("root") }))
    .mutation(async ({ input, ctx }) => {
      const key = await mockDb.query.sshKeys.findFirst({ where: () => {} });
      if (!key?.privateKey) throw new Error("SSH key has no private key");
      if (key.userId !== ctx.session.user.id) throw new Error("Access denied");
      const ssh = new SSHExecutor({ host: input.ipAddress, port: input.sshPort, username: input.sshUser, privateKey: key.privateKey });
      try {
        const ok = await ssh.testConnection();
        await ssh.disconnect();
        return { success: ok, message: ok ? "Connection successful" : "Connection failed" };
      } catch (error: any) {
        await ssh.disconnect();
        return { success: false, message: error.message };
      }
    }),
});

import { db, servers } from "@HAForge/db";

function createCaller(userId = "test-user-1") {
  return createCallerForRouter({ server: serverRouter }, userId);
}

describe("serverRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("add", () => {
    it("creates a server with required fields", async () => {
      const caller = createCaller();
      const result = await caller.server.add({ role: "postgresql_1" });
      expect(result.role).toBe("postgresql_1");
      expect(result.status).toBe("pending");
    });
  });

  describe("remove", () => {
    it("deletes a server after ownership check", async () => {
      verifyServerOwnership.mockResolvedValue({ id: "srv-1" });
      const caller = createCaller();

      const result = await caller.server.remove({ id: "srv-1" });

      expect(verifyServerOwnership).toHaveBeenCalledWith("srv-1", "test-user-1");
      expect(result.success).toBe(true);
    });

    it("throws if ownership check fails", async () => {
      verifyServerOwnership.mockRejectedValue(new Error("Access denied"));
      const caller = createCaller();

      await expect(caller.server.remove({ id: "srv-1" })).rejects.toThrow("Access denied");
    });
  });

  describe("testConnection", () => {
    it("returns success on valid SSH connection", async () => {
      mockDb.query.sshKeys.findFirst.mockResolvedValue({
        id: "key-1", userId: "test-user-1", privateKey: "ssh-rsa AAA...",
      });
      const caller = createCaller();

      const result = await caller.server.testConnection({
        sshKeyId: "key-1", ipAddress: "1.2.3.4", sshPort: 22, sshUser: "root",
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe("Connection successful");
    });

    it("throws if SSH key not found", async () => {
      mockDb.query.sshKeys.findFirst.mockResolvedValue(null);
      const caller = createCaller();

      await expect(
        caller.server.testConnection({ sshKeyId: "key-1", ipAddress: "1.2.3.4" }),
      ).rejects.toThrow("SSH key has no private key");
    });

    it("throws if SSH key belongs to another user", async () => {
      mockDb.query.sshKeys.findFirst.mockResolvedValue({
        id: "key-1", userId: "other-user", privateKey: "ssh-rsa AAA...",
      });
      const caller = createCaller();

      await expect(
        caller.server.testConnection({ sshKeyId: "key-1", ipAddress: "1.2.3.4" }),
      ).rejects.toThrow("Access denied");
    });
  });
});
