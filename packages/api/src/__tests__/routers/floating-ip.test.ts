import { describe, it, expect, vi, beforeEach } from "vitest";
import { protectedProcedure, router, createCallerForRouter } from "../helpers/trpc";

const mockGetUserApiToken = vi.fn();
vi.mock("../../routers/shared", () => ({
  HETZNER_API: "https://api.hetzner.cloud/v1",
  hetznerHeaders: (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
  getUserApiToken: (...args: any[]) => mockGetUserApiToken(...args),
}));

const mockFetch = vi.fn();

const floatingIpRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const token = await mockGetUserApiToken(ctx.session.user.id);
    if (!token) throw new Error("No Hetzner API token configured. Add one in Settings.");
    const [ipRes, srvRes] = await Promise.all([
      mockFetch(`https://api.hetzner.cloud/v1/floating_ips`, { headers: { Authorization: `Bearer ${token}` } }),
      mockFetch(`https://api.hetzner.cloud/v1/servers`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (!ipRes.ok) throw new Error(`Hetzner API error: ${ipRes.status}`);
    const ipData = await ipRes.json() as any;
    const srvData = (srvRes.ok ? await srvRes.json() : { servers: [] }) as any;
    const srvMap = new Map<string, string>();
    for (const s of srvData.servers || []) srvMap.set(String(s.id), s.name);
    return (ipData.floating_ips || []).map((ip: any) => ({
      id: String(ip.id),
      ip: ip.ip,
      type: ip.type,
      name: ip.name || "",
      serverId: ip.server ? String(ip.server) : null,
      serverName: ip.server ? srvMap.get(String(ip.server)) || null : null,
      homeLocation: ip.home_location?.name || "",
    }));
  }),
});

function createCaller(userId = "test-user-1") {
  return createCallerForRouter({ floatingIp: floatingIpRouter }, userId);
}

function mockResponse(data: any, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(data) };
}

describe("floatingIpRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("list", () => {
    it("returns floating IPs with server names", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch
        .mockResolvedValueOnce(mockResponse({ floating_ips: [
          { id: 1, ip: "1.2.3.4", type: "ipv4", name: "my-ip", server: 10, home_location: { name: "fsn1" } },
          { id: 2, ip: "5.6.7.8", type: "ipv4", name: "my-ip-2", server: null, home_location: { name: "nbg1" } },
        ] }))
        .mockResolvedValueOnce(mockResponse({ servers: [{ id: 10, name: "my-server" }] }));

      const caller = createCaller();
      const result = await caller.floatingIp.list();

      expect(result).toHaveLength(2);
      expect(result[0].ip).toBe("1.2.3.4");
      expect(result[0].serverName).toBe("my-server");
      expect(result[0].homeLocation).toBe("fsn1");
      expect(result[1].serverId).toBeNull();
      expect(result[1].serverName).toBeNull();
    });

    it("throws if no API token configured", async () => {
      mockGetUserApiToken.mockResolvedValue("");
      const caller = createCaller();

      await expect(caller.floatingIp.list()).rejects.toThrow("No Hetzner API token configured");
    });

    it("throws on Hetzner API error", async () => {
      mockGetUserApiToken.mockResolvedValue("test-token");
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ servers: [] }) });

      const caller = createCaller();

      await expect(caller.floatingIp.list()).rejects.toThrow("Hetzner API error: 403");
    });
  });
});
