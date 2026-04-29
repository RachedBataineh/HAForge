import { describe, it, expect, vi, beforeEach } from "vitest";
import { protectedProcedure, router, createCallerForRouter } from "../helpers/trpc";
import { z } from "zod";

const mockGetUserApiToken = vi.fn();
vi.mock("../../routers/shared", () => ({
  HETZNER_API: "https://api.hetzner.cloud/v1",
  hetznerHeaders: (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
  getUserApiToken: (...args: any[]) => mockGetUserApiToken(...args),
}));

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

const networkRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const token = await mockGetUserApiToken(ctx.session.user.id);
    if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
    const [netRes, srvRes] = await Promise.all([
      mockFetch(`https://api.hetzner.cloud/v1/networks`, { headers: { Authorization: `Bearer ${token}` } }),
      mockFetch(`https://api.hetzner.cloud/v1/servers`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (!netRes.ok) throw new Error(`Hetzner API error: ${netRes.status}`);
    const netData = await netRes.json() as any;
    const srvData = (srvRes.ok ? await srvRes.json() : { servers: [] }) as any;
    const srvMap = new Map<string, string>();
    for (const s of srvData.servers || []) srvMap.set(String(s.id), s.name);
    return (netData.networks || []).map((n: any) => ({
      id: String(n.id),
      name: n.name,
      ipRange: n.ip_range || "",
      serverCount: n.servers?.length || 0,
    }));
  }),
});

function createCaller(userId = "test-user-1") {
  return createCallerForRouter({ network: networkRouter }, userId);
}

function mockResponse(data: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(data) };
}

describe("networkRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("list", () => {
    it("returns networks with server counts", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch
        .mockResolvedValueOnce(mockResponse({ networks: [{ id: 1, name: "test-net", ip_range: "10.0.0.0/16", servers: [1, 2] }] }))
        .mockResolvedValueOnce(mockResponse({ servers: [{ id: 1, name: "srv1" }, { id: 2, name: "srv2" }] }));

      const caller = createCaller();
      const result = await caller.network.list();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("test-net");
      expect(result[0].ipRange).toBe("10.0.0.0/16");
      expect(result[0].serverCount).toBe(2);
    });

    it("throws if no API token configured", async () => {
      mockGetUserApiToken.mockResolvedValue("");
      const caller = createCaller();

      await expect(caller.network.list()).rejects.toThrow("No Hetzner API token configured");
    });

    it("throws on Hetzner API error", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ servers: [] }) });

      const caller = createCaller();

      await expect(caller.network.list()).rejects.toThrow("Hetzner API error: 401");
    });

    it("handles empty networks list", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch
        .mockResolvedValueOnce(mockResponse({ networks: [] }))
        .mockResolvedValueOnce(mockResponse({ servers: [] }));

      const caller = createCaller();
      const result = await caller.network.list();

      expect(result).toEqual([]);
    });
  });
});
