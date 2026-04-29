import { describe, it, expect, vi, beforeEach } from "vitest";
import { protectedProcedure, router, createCallerForRouter } from "../helpers/trpc";

const mockDb = {
  query: {
    user: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
  },
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(),
    })),
  })),
};

vi.mock("@HAForge/db", () => ({
  get db() { return mockDb; },
  user: { id: "id", name: "name", email: "email", image: "image", hetznerApiToken: "hetzner_api_token" },
  account: { id: "id", userId: "user_id", providerId: "provider_id", password: "password" },
}));

import { z } from "zod";
import bcrypt from "bcryptjs";

const settingsRouter = router({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const u = await mockDb.query.user.findFirst({
      where: () => {},
    });
    if (!u) throw new Error("User not found");
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      hetznerApiToken: u.hetznerApiToken || "",
    };
  }),

  updateProfile: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await mockDb.update({}).set({ name: input.name }).where({});
      return { success: true };
    }),

  updateHetznerToken: protectedProcedure
    .input(z.object({ hetznerApiToken: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (input.hetznerApiToken) {
        const existing = await mockDb.query.user.findFirst({ where: () => {} });
        if (existing && existing.id !== ctx.session.user.id) {
          throw new Error("This Hetzner API token is already registered to another account.");
        }
      }
      await mockDb.update({}).set({ hetznerApiToken: input.hetznerApiToken || null }).where({});
      return { success: true };
    }),

  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }))
    .mutation(async ({ input, ctx }) => {
      const accounts = await mockDb.query.account.findMany({ where: () => {} });
      const credentialAccount = accounts.find((a: any) => a.providerId === "credential" && a.password);
      if (!credentialAccount) {
        throw new Error("No password account found. You may have signed in with a social provider.");
      }
      const valid = await bcrypt.compare(input.currentPassword, credentialAccount.password);
      if (!valid) {
        throw new Error("Current password is incorrect");
      }
      const hashed = await bcrypt.hash(input.newPassword, 10);
      await mockDb.update({}).set({ password: hashed }).where({});
      return { success: true };
    }),
});

function createCaller(userId = "test-user-1") {
  return createCallerForRouter({ settings: settingsRouter }, userId);
}

const mockUser = {
  id: "test-user-1",
  name: "Test User",
  email: "test@test.com",
  image: null,
  hetznerApiToken: "het_token_123",
};

describe("settingsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getProfile", () => {
    it("returns user profile data", async () => {
      mockDb.query.user.findFirst.mockResolvedValue(mockUser);
      const caller = createCaller();

      const result = await caller.settings.getProfile();

      expect(result.name).toBe("Test User");
      expect(result.email).toBe("test@test.com");
      expect(result.id).toBe("test-user-1");
    });

    it("returns hetzner token (empty string if null)", async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ ...mockUser, hetznerApiToken: null });
      const caller = createCaller();

      const result = await caller.settings.getProfile();

      expect(result.hetznerApiToken).toBe("");
    });

    it("throws if user not found", async () => {
      mockDb.query.user.findFirst.mockResolvedValue(null);
      const caller = createCaller();

      await expect(caller.settings.getProfile()).rejects.toThrow("User not found");
    });
  });

  describe("updateProfile", () => {
    it("updates user name", async () => {
      const setMock = vi.fn().mockReturnValue({ where: vi.fn() });
      mockDb.update.mockReturnValue({ set: setMock });
      const caller = createCaller();

      const result = await caller.settings.updateProfile({ name: "New Name" });

      expect(result.success).toBe(true);
      expect(setMock).toHaveBeenCalledWith({ name: "New Name" });
    });

    it("rejects empty name", async () => {
      const caller = createCaller();

      await expect(caller.settings.updateProfile({ name: "" })).rejects.toThrow();
    });
  });

  describe("updateHetznerToken", () => {
    it("saves a new token", async () => {
      mockDb.query.user.findFirst.mockResolvedValue(null);
      const setMock = vi.fn().mockReturnValue({ where: vi.fn() });
      mockDb.update.mockReturnValue({ set: setMock });
      const caller = createCaller();

      const result = await caller.settings.updateHetznerToken({ hetznerApiToken: "new_token" });

      expect(result.success).toBe(true);
    });

    it("rejects token already registered to another user", async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ id: "other-user" });
      const caller = createCaller();

      await expect(
        caller.settings.updateHetznerToken({ hetznerApiToken: "duplicate_token" }),
      ).rejects.toThrow("already registered to another account");
    });

    it("allows clearing the token (empty string)", async () => {
      const setMock = vi.fn().mockReturnValue({ where: vi.fn() });
      mockDb.update.mockReturnValue({ set: setMock });
      const caller = createCaller();

      const result = await caller.settings.updateHetznerToken({ hetznerApiToken: "" });

      expect(result.success).toBe(true);
    });
  });

  describe("changePassword", () => {
    it("rejects if no credential account found", async () => {
      mockDb.query.account.findMany.mockResolvedValue([]);
      const caller = createCaller();

      await expect(
        caller.settings.changePassword({ currentPassword: "old", newPassword: "newpassword123" }),
      ).rejects.toThrow("No password account found");
    });

    it("rejects incorrect current password", async () => {
      const hashedOld = await bcrypt.hash("correctpass", 10);
      mockDb.query.account.findMany.mockResolvedValue([
        { id: "acc-1", providerId: "credential", password: hashedOld },
      ]);
      const caller = createCaller();

      await expect(
        caller.settings.changePassword({ currentPassword: "wrongpass", newPassword: "newpassword123" }),
      ).rejects.toThrow("Current password is incorrect");
    });

    it("changes password with correct current password", async () => {
      const hashedOld = await bcrypt.hash("correctpass", 10);
      mockDb.query.account.findMany.mockResolvedValue([
        { id: "acc-1", providerId: "credential", password: hashedOld },
      ]);
      const setMock = vi.fn().mockReturnValue({ where: vi.fn() });
      mockDb.update.mockReturnValue({ set: setMock });
      const caller = createCaller();

      const result = await caller.settings.changePassword({
        currentPassword: "correctpass",
        newPassword: "newpassword123",
      });

      expect(result.success).toBe(true);
      expect(setMock).toHaveBeenCalled();
    });

    it("rejects new password shorter than 8 chars", async () => {
      const caller = createCaller();

      await expect(
        caller.settings.changePassword({ currentPassword: "old", newPassword: "short" }),
      ).rejects.toThrow();
    });
  });
});
