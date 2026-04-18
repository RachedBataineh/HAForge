export interface HetznerFloatingIP {
  id: number;
  ip: string;
  description: string;
  server: number | null;
}

export interface HetznerServer {
  id: number;
  name: string;
  publicIp: string;
}

class HetznerClient {
  private token: string;
  private baseUrl = "https://api.hetzner.cloud/v1";

  constructor(token: string) {
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hetzner API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  async listFloatingIPs(): Promise<HetznerFloatingIP[]> {
    const data = await this.request("/floating_ips");
    return data.floating_ips.map((fip: any) => ({
      id: fip.id,
      ip: fip.ip,
      description: fip.description || "",
      server: fip.server,
    }));
  }

  async getFloatingIP(id: number): Promise<HetznerFloatingIP> {
    const data = await this.request(`/floating_ips/${id}`);
    return {
      id: data.floating_ip.id,
      ip: data.floating_ip.ip,
      description: data.floating_ip.description || "",
      server: data.floating_ip.server,
    };
  }

  async assignFloatingIP(floatingIpId: number, serverId: number): Promise<void> {
    await this.request(`/floating_ips/${floatingIpId}/actions/assign`, {
      method: "POST",
      body: JSON.stringify({ server: serverId }),
    });
  }

  async listServers(): Promise<HetznerServer[]> {
    const data = await this.request("/servers");
    return data.servers.map((s: any) => ({
      id: s.id,
      name: s.name,
      publicIp: s.public_net?.ipv4?.ip || "",
    }));
  }
}

export function createHetznerClient(token: string): HetznerClient {
  return new HetznerClient(token);
}
