import { describe, it, expect, vi, beforeEach } from "vitest";
import { protectedProcedure, router, createCallerForRouter } from "../helpers/trpc";

const mockGetUserApiToken = vi.fn();
vi.mock("../../routers/shared", () => ({
  HETZNER_API: "https://api.hetzner.cloud/v1",
  hetznerHeaders: (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
  getUserApiToken: (...args: any[]) => mockGetUserApiToken(...args),
}));

const mockFetch = vi.fn();

const firewallRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const token = await mockGetUserApiToken(ctx.session.user.id);
    if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
    const res = await mockFetch(`https://api.hetzner.cloud/v1/firewalls`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Hetzner API error: ${res.status}`);
    const data = await res.json() as any;
    return (data.firewalls || []).map((fw: any) => ({
      id: String(fw.id),
      name: fw.name || "",
      rulesCount: (fw.rules || []).length,
      appliedToCount: (fw.applied_to || []).length,
      created: fw.created || "",
    }));
  }),
});

function createCaller(userId = "test-user-1") {
  return createCallerForRouter({ firewall: firewallRouter }, userId);
}

function mockResponse(data: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(data) };
}

describe("firewallRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("list", () => {
    it("returns firewalls with rule counts", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch.mockResolvedValueOnce(mockResponse({ firewalls: [
        { id: 1, name: "fw-1", rules: [{ direction: "in" }, { direction: "out" }], applied_to: [{ type: "server" }], created: "2024-01-01" },
        { id: 2, name: "fw-2", rules: [], applied_to: [], created: "2024-02-01" },
      ] }));

      const caller = createCaller();
      const result = await caller.firewall.list();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("fw-1");
      expect(result[0].rulesCount).toBe(2);
      expect(result[0].appliedToCount).toBe(1);
      expect(result[1].rulesCount).toBe(0);
    });

    it("throws if no API token configured", async () => {
      mockGetUserApiToken.mockResolvedValue("");
      const caller = createCaller();

      await expect(caller.firewall.list()).rejects.toThrow("No Hetzner API token configured");
    });

    it("throws on Hetzner API error", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 422, json: () => Promise.resolve({}) });

      const caller = createCaller();

      await expect(caller.firewall.list()).rejects.toThrow("Hetzner API error: 422");
    });

    it("handles empty firewall list", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch.mockResolvedValueOnce(mockResponse({ firewalls: [] }));

      const caller = createCaller();
      const result = await caller.firewall.list();

      expect(result).toEqual([]);
    });
  });
});
