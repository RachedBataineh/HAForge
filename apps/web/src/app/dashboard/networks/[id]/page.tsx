"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@HAForge/ui/components/dropdown-menu";
import { ArrowLeft, Loader2, Globe, Server, Network, HardDrive, Plus, Trash2, Link, Unlink, ChevronDown } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

/* ─── Helpers ──────────────────────────────────────── */

function ipToNum(ip: string) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function cidrToRange(cidr: string): { start: number; end: number } | null {
  const [ip, bits] = cidr.split("/");
  if (!ip || !bits) return null;
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0;
  const base = ipToNum(ip) & mask;
  return { start: base, end: base + (1 << (32 - parseInt(bits, 10))) - 1 };
}

function ipInSubnet(ip: string, subnetCidr: string) {
  const range = cidrToRange(subnetCidr);
  if (!range) return false;
  const num = ipToNum(ip);
  return num >= range.start && num <= range.end;
}

function nextAvailableIp(subnetCidr: string, usedIps: string[]) {
  const range = cidrToRange(subnetCidr);
  if (!range) return "";
  const used = new Set(usedIps.map(ipToNum));
  // skip network (.0) and broadcast (.255 for /24), start from .2 (gateway is usually .1)
  for (let ip = range.start + 2; ip <= range.end - 1; ip++) {
    if (!used.has(ip)) {
      return [
        (ip >>> 24) & 255,
        (ip >>> 16) & 255,
        (ip >>> 8) & 255,
        ip & 255,
      ].join(".");
    }
  }
  return "";
}

function suggestSubnetIpRange(networkRange: string, existingSubnets: { ipRange: string }[]) {
  const used = new Set(existingSubnets.map((s) => s.ipRange));
  const base = networkRange.replace(/\/\d+$/, "");
  const parts = base.split(".");
  for (let i = 1; i <= 255; i++) {
    const candidate = `${parts[0]}.${parts[1]}.${i}.0/24`;
    if (!used.has(candidate)) return candidate;
  }
  return `${parts[0]}.${parts[1]}.1.0/24`;
}

/* ─── Main Page ────────────────────────────────────── */

export default function NetworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: networkId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const apiToken = profile.data?.hetznerApiToken || "";

  const net = useQuery(
    trpc.network.details.queryOptions(
      { apiToken, networkId },
      { enabled: !!apiToken && !!networkId },
    ),
  );

  const invalidate = () => {
    queryClient.invalidateQueries(trpc.network.details.queryFilter());
    queryClient.invalidateQueries(trpc.network.list.queryFilter());
  };

  if (!apiToken) {
    return <div className="p-6"><p className="text-muted-foreground">Add your Hetzner API token in Settings first.</p></div>;
  }

  if (net.isLoading) {
    return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading network details...</div>;
  }

  const data = net.data;
  if (!data) {
    return <div className="p-6"><p className="text-muted-foreground">Network not found.</p></div>;
  }

  // Group servers by subnet based on their private IP
  const serversBySubnet = new Map<string, any[]>();
  const unassignedServers: any[] = [];
  for (const s of data.servers) {
    if (!s.privateIp) { unassignedServers.push(s); continue; }
    const subnet = data.subnets.find((sub: any) => ipInSubnet(s.privateIp, sub.ipRange));
    if (subnet) {
      const list = serversBySubnet.get(subnet.ipRange) || [];
      list.push(s);
      serversBySubnet.set(subnet.ipRange, list);
    } else {
      unassignedServers.push(s);
    }
  }

  // Group LBs by subnet
  const lbsBySubnet = new Map<string, any[]>();
  const unassignedLBs: any[] = [];
  for (const lb of data.loadBalancers) {
    if (!lb.privateIp) { unassignedLBs.push(lb); continue; }
    const subnet = data.subnets.find((sub: any) => ipInSubnet(lb.privateIp, sub.ipRange));
    if (subnet) {
      const list = lbsBySubnet.get(subnet.ipRange) || [];
      list.push(lb);
      lbsBySubnet.set(subnet.ipRange, list);
    } else {
      unassignedLBs.push(lb);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 pb-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
              {data.protection && <Badge variant="outline">Protected</Badge>}
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{data.ipRange}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">ID</span>
                <p className="font-mono">{data.id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">IP Range</span>
                <p className="font-mono">{data.ipRange}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created</span>
                <p>{new Date(data.created).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Routes to vSwitch</span>
                <p>{data.exposeRoutesToVswitch ? "Enabled" : "Disabled"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subnets — each with its own servers & LBs */}
        <SubnetsSection
          data={data}
          apiToken={apiToken}
          networkId={networkId}
          onDone={invalidate}
          router={router}
          serversBySubnet={serversBySubnet}
          lbsBySubnet={lbsBySubnet}
        />
      </div>
    </div>
  );
}

/* ─── Subnets Section ──────────────────────────────── */

function SubnetsSection({ data, apiToken, networkId, onDone, router, serversBySubnet, lbsBySubnet }: any) {
  const [addOpen, setAddOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async (vals: any) => trpcClient.network.deleteSubnet.mutate(vals),
    onSuccess: () => { toast.success("Subnet deleted"); onDone(); },
    onError: (err: any) => toast.error(err.message),
  });

  const suggested = suggestSubnetIpRange(data.ipRange, data.subnets);

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Network className="size-5" /> Subnets ({data.subnets.length})
        </h2>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" /> Add Subnet
        </Button>
      </div>

      {data.subnets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Network className="size-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">No subnets yet. Add one to start assigning IPs.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.subnets.map((subnet: any) => (
            <SubnetCard
              key={subnet.ipRange}
              subnet={subnet}
              data={data}
              apiToken={apiToken}
              networkId={networkId}
              onDone={onDone}
              router={router}
              servers={serversBySubnet.get(subnet.ipRange) || []}
              loadBalancers={lbsBySubnet.get(subnet.ipRange) || []}
              onDelete={() => deleteMutation.mutate({ apiToken, networkId, ipRange: subnet.ipRange })}
              deleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Subnet</DialogTitle></DialogHeader>
          <AddSubnetForm
            apiToken={apiToken}
            networkId={networkId}
            networkZone={data.subnets?.[0]?.networkZone || "eu-central"}
            suggested={suggested}
            onDone={() => { setAddOpen(false); onDone(); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Single Subnet Card (contains its servers & LBs) */

function SubnetCard({ subnet, data, apiToken, networkId, onDone, router, servers, loadBalancers, onDelete, deleting }: any) {
  const [attachOpen, setAttachOpen] = useState<"server" | "lb" | null>(null);

  const detachServerMutation = useMutation({
    mutationFn: async (vals: any) => trpcClient.network.detachServer.mutate(vals),
    onSuccess: () => { toast.success("Server detached"); onDone(); },
    onError: (err: any) => toast.error(err.message),
  });

  const detachLbMutation = useMutation({
    mutationFn: async (vals: any) => trpcClient.network.detachLoadBalancer.mutate(vals),
    onSuccess: () => { toast.success("Load balancer detached"); onDone(); },
    onError: (err: any) => toast.error(err.message),
  });

  // Unattached servers/LBs that could be attached to this subnet
  const availableServers = (data.allServers || []).filter((s: any) => !s.attached);
  const availableLBs = (data.allLoadBalancers || []).filter((lb: any) => !lb.attached);

  // Used IPs in this subnet for auto-suggest
  const usedIps = [
    ...servers.map((s: any) => s.privateIp).filter(Boolean),
    ...loadBalancers.map((lb: any) => lb.privateIp).filter(Boolean),
  ];

  return (
    <>
      <Card>
        {/* Subnet header */}
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Network className="size-4 text-primary" />
              </div>
              <div>
                <p className="font-mono font-semibold text-sm">{subnet.ipRange}</p>
                <p className="text-xs text-muted-foreground">
                  Gateway: {subnet.gateway} &middot; {subnet.networkZone}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{subnet.type}</Badge>
              <Badge variant="outline">{servers.length} server{servers.length !== 1 ? "s" : ""}</Badge>
              <Badge variant="outline">{loadBalancers.length} LB{loadBalancers.length !== 1 ? "s" : ""}</Badge>
              <Button variant="ghost" size="icon-sm" onClick={onDelete} disabled={deleting}>
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-4">
          {/* Servers in this subnet */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive className="size-3" /> Servers
              </h4>
              <Button size="sm" variant="ghost" className="h-6 text-xs gap-1"
                onClick={() => setAttachOpen("server")}
                disabled={availableServers.length === 0}
              >
                <Plus className="size-3" /> Attach
              </Button>
            </div>
            {servers.length === 0 ? (
              <p className="text-xs text-muted-foreground pl-0.5">No servers in this subnet.</p>
            ) : (
              <div className="space-y-1">
                {servers.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2 group">
                    <div
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80 flex-1 min-w-0"
                      onClick={() => router.push(`/dashboard/servers/hetzner-${s.id}`)}
                    >
                      <HardDrive className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{s.name}</span>
                      {s.privateIp && <span className="text-xs font-mono text-muted-foreground">{s.privateIp}</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={s.status === "running" ? "default" : "secondary"} className="text-[10px] px-1.5">
                        {s.status === "running" ? "Running" : s.status === "off" ? "Off" : s.status}
                      </Badge>
                      <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100"
                        onClick={() => detachServerMutation.mutate({ apiToken, networkId, serverId: s.id })}
                        disabled={detachServerMutation.isPending}
                      >
                        <Unlink className="size-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Load Balancers in this subnet */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="size-3" /> Load Balancers
              </h4>
              <Button size="sm" variant="ghost" className="h-6 text-xs gap-1"
                onClick={() => setAttachOpen("lb")}
                disabled={availableLBs.length === 0}
              >
                <Plus className="size-3" /> Attach
              </Button>
            </div>
            {loadBalancers.length === 0 ? (
              <p className="text-xs text-muted-foreground pl-0.5">No load balancers in this subnet.</p>
            ) : (
              <div className="space-y-1">
                {loadBalancers.map((lb: any) => (
                  <div key={lb.id} className="flex items-center justify-between rounded-md border px-3 py-2 group">
                    <div
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80 flex-1 min-w-0"
                      onClick={() => router.push(`/dashboard/load-balancers/${lb.id}`)}
                    >
                      <Globe className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{lb.name}</span>
                      {lb.privateIp && <span className="text-xs font-mono text-muted-foreground">{lb.privateIp}</span>}
                    </div>
                    <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100"
                      onClick={() => detachLbMutation.mutate({ apiToken, networkId, loadBalancerId: lb.id })}
                      disabled={detachLbMutation.isPending}
                    >
                      <Unlink className="size-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Attach Server Dialog */}
      <Dialog open={attachOpen === "server"} onOpenChange={(open) => { if (!open) setAttachOpen(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Attach Server to {subnet.ipRange}</DialogTitle></DialogHeader>
          <AttachServerForm
            apiToken={apiToken}
            networkId={networkId}
            servers={availableServers}
            suggestedIp={nextAvailableIp(subnet.ipRange, usedIps)}
            onDone={() => { setAttachOpen(null); onDone(); }}
          />
        </DialogContent>
      </Dialog>

      {/* Attach LB Dialog */}
      <Dialog open={attachOpen === "lb"} onOpenChange={(open) => { if (!open) setAttachOpen(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Attach Load Balancer to {subnet.ipRange}</DialogTitle></DialogHeader>
          <AttachLBForm
            apiToken={apiToken}
            networkId={networkId}
            loadBalancers={availableLBs}
            suggestedIp={nextAvailableIp(subnet.ipRange, usedIps)}
            onDone={() => { setAttachOpen(null); onDone(); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Add Subnet Form ──────────────────────────────── */

function AddSubnetForm({ apiToken, networkId, networkZone, suggested, onDone }: any) {
  const [ipRange, setIpRange] = useState(suggested);
  const [zone, setZone] = useState(networkZone);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!ipRange) { toast.error("IP range is required"); return; }
    setCreating(true);
    try {
      await trpcClient.network.addSubnet.mutate({ apiToken, networkId, ipRange, networkZone: zone });
      toast.success("Subnet added");
      onDone();
    } catch (err: any) { toast.error(err.message); }
    finally { setCreating(false); }
  };

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label className="text-sm">IP Range (CIDR)</Label>
          <Input placeholder="10.0.1.0/24" value={ipRange} onChange={(e) => setIpRange(e.target.value)} />
          <p className="text-xs text-muted-foreground">Subnet range within the network&apos;s {suggested.split("/")[0].split(".").slice(0, 2).join(".*.*")}/16</p>
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Network Zone</Label>
          <Select value={zone} onValueChange={(v) => setZone(v ?? "eu-central")}>
            <SelectTrigger className="w-full">
              {zone === "eu-central" ? "EU Central" : zone === "us-east" ? "US East" : zone === "us-west" ? "US West" : "AP Southeast"}
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              <SelectItem value="eu-central">EU Central</SelectItem>
              <SelectItem value="us-east">US East</SelectItem>
              <SelectItem value="us-west">US West</SelectItem>
              <SelectItem value="ap-southeast">AP Southeast</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Type</Label>
          <Select defaultValue="cloud" disabled>
            <SelectTrigger className="w-full"><span>Cloud</span></SelectTrigger>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={handleCreate} disabled={!ipRange || creating}>
          {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />} Add
        </Button>
      </DialogFooter>
    </>
  );
}

/* ─── Attach Server Form (per subnet) ──────────────── */

function AttachServerForm({ apiToken, networkId, servers, suggestedIp, onDone }: any) {
  const [serverId, setServerId] = useState("");
  const [ip, setIp] = useState(suggestedIp);
  const [attaching, setAttaching] = useState(false);

  const handleAttach = async () => {
    if (!serverId) { toast.error("Select a server"); return; }
    setAttaching(true);
    try {
      await trpcClient.network.attachServer.mutate({ apiToken, networkId, serverId, ip: ip || undefined });
      toast.success("Server attached");
      onDone();
    } catch (err: any) { toast.error(err.message); }
    finally { setAttaching(false); }
  };

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label className="text-sm">Server</Label>
          <Select value={serverId} onValueChange={(v) => setServerId(v ?? "")}>
            <SelectTrigger className="w-full">
              {serverId
                ? <span>{servers.find((s: any) => s.id === serverId)?.name || serverId}</span>
                : <span className="text-muted-foreground">Select a server</span>}
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              {servers.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {s.publicIp ? `(${s.publicIp})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {servers.length === 0 && <p className="text-xs text-muted-foreground">All servers are already attached to this network.</p>}
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Private IP (optional — auto-assigned if empty)</Label>
          <Input placeholder={suggestedIp} value={ip} onChange={(e) => setIp(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={handleAttach} disabled={!serverId || attaching}>
          {attaching ? <Loader2 className="size-4 animate-spin mr-2" /> : <Link className="size-4 mr-2" />} Attach
        </Button>
      </DialogFooter>
    </>
  );
}

/* ─── Attach LB Form (per subnet) ──────────────────── */

function AttachLBForm({ apiToken, networkId, loadBalancers, suggestedIp, onDone }: any) {
  const [lbId, setLbId] = useState("");
  const [ip, setIp] = useState(suggestedIp);
  const [attaching, setAttaching] = useState(false);

  const handleAttach = async () => {
    if (!lbId) { toast.error("Select a load balancer"); return; }
    setAttaching(true);
    try {
      await trpcClient.network.attachLoadBalancer.mutate({ apiToken, networkId, loadBalancerId: lbId, ip: ip || undefined });
      toast.success("Load balancer attached");
      onDone();
    } catch (err: any) { toast.error(err.message); }
    finally { setAttaching(false); }
  };

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label className="text-sm">Load Balancer</Label>
          <Select value={lbId} onValueChange={(v) => setLbId(v ?? "")}>
            <SelectTrigger className="w-full">
              {lbId
                ? <span>{loadBalancers.find((lb: any) => lb.id === lbId)?.name || lbId}</span>
                : <span className="text-muted-foreground">Select a load balancer</span>}
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              {loadBalancers.map((lb: any) => (
                <SelectItem key={lb.id} value={lb.id}>
                  {lb.name} {lb.publicIp ? `(${lb.publicIp})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loadBalancers.length === 0 && <p className="text-xs text-muted-foreground">All load balancers are already attached to this network.</p>}
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Private IP (optional — auto-assigned if empty)</Label>
          <Input placeholder={suggestedIp} value={ip} onChange={(e) => setIp(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={handleAttach} disabled={!lbId || attaching}>
          {attaching ? <Loader2 className="size-4 animate-spin mr-2" /> : <Link className="size-4 mr-2" />} Attach
        </Button>
      </DialogFooter>
    </>
  );
}
