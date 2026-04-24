"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { Separator } from "@HAForge/ui/components/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Network, Plus, Loader2, Trash2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { trpc, trpcClient } from "@/utils/trpc";

export default function LoadBalancersPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLb, setDeleteLb] = useState<{ id: string; name: string } | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = !!profile.data?.hetznerApiToken;

  const loadBalancers = useQuery(
    trpc.cluster.hetznerLoadBalancers.queryOptions(undefined, { enabled: hasToken }),
  );

  const lbTypes = useQuery(
    trpc.cluster.hetznerLoadBalancerTypes.queryOptions(undefined, { enabled: hasToken && createOpen }),
  );

  const locations = useQuery(
    trpc.cluster.hetznerLocations.queryOptions(undefined, { enabled: hasToken && createOpen }),
  );

  const lbList = (loadBalancers.data ?? []) as any[];

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      return await trpcClient.cluster.hetznerDeleteLoadBalancer.mutate({ loadBalancerId: id });
    },
    onSuccess: () => {
      toast.success("Load balancer deleted");
      loadBalancers.refetch();
      setDeleteOpen(false);
      setDeleteLb(null);
      setDeleteName("");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (!hasToken) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Load Balancers</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <Network className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Add your Hetzner API token in Settings to manage load balancers.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Load Balancers</h1>
          <p className="text-muted-foreground">Manage Hetzner Cloud Load Balancers</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Create Load Balancer
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold">{lbList.length}</div>
            <p className="text-xs text-muted-foreground">Total Load Balancers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold text-green-600">{lbList.filter((lb: any) => lb.targets?.length > 0).length}</div>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
      </div>

      {loadBalancers.isLoading && (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loadBalancers.isLoading && lbList.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Network className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No load balancers found. Create one to get started.</p>
          </CardContent>
        </Card>
      )}

      {lbList.length > 0 && (
        <div className="grid gap-3">
          {lbList.map((lb: any) => (
            <Card key={lb.id} className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/load-balancers/${lb.id}`)}
            >
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Network className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{lb.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{lb.publicIp}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{lb.location}</span>
                  <span className="text-xs text-muted-foreground">{lb.type}</span>
                  <Badge variant="secondary">{lb.targets?.length || 0} targets</Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteLb({ id: lb.id, name: lb.name });
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <CreateLoadBalancerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        lbTypes={lbTypes}
        locations={locations}
        onCreated={() => {
          loadBalancers.refetch();
          setCreateOpen(false);
        }}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Load Balancer</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type <span className="font-mono font-semibold">{deleteLb?.name}</span> to confirm deletion.
          </p>
          <Input
            placeholder={deleteLb?.name}
            value={deleteName}
            onChange={(e) => setDeleteName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && deleteName === deleteLb?.name && deleteLb) {
                deleteMutation.mutate({ id: deleteLb.id });
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteLb(null); setDeleteName(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteName !== deleteLb?.name || deleteMutation.isPending}
              onClick={() => {
                if (deleteLb) deleteMutation.mutate({ id: deleteLb.id });
              }}
            >
              {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateLoadBalancerDialog({
  open, onOpenChange, lbTypes, locations, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lbTypes: any;
  locations: any;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [lbType, setLbType] = useState("");
  const [location, setLocation] = useState("");
  const [networkId, setNetworkId] = useState("");
  const [algorithm, setAlgorithm] = useState("round_robin");
  const [svcProtocol, setSvcProtocol] = useState("tcp");
  const [svcListenPort, setSvcListenPort] = useState(5432);
  const [svcDestPort, setSvcDestPort] = useState(5432);
  const [hcProtocol, setHcProtocol] = useState("http");
  const [hcPort, setHcPort] = useState(8008);
  const [hcInterval, setHcInterval] = useState(5);
  const [hcTimeout, setHcTimeout] = useState(3);
  const [hcRetries, setHcRetries] = useState(3);
  const [hcPath, setHcPath] = useState("/leader");
  const [hcStatuses, setHcStatuses] = useState("200");
  const [hcTls, setHcTls] = useState(false);
  const [creating, setCreating] = useState(false);

  const lbTypesData = (lbTypes.data ?? []) as any[];
  const locationsData = (locations.data ?? []) as any[];

  const networks = useQuery(
    trpc.cluster.hetznerNetworks.queryOptions(undefined, { enabled: open }),
  );
  const networksData = (networks.data ?? []) as any[];

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setName("");
      setLbType("");
      setLocation("");
      setNetworkId("");
      setAlgorithm("round_robin");
      setSvcProtocol("tcp");
      setSvcListenPort(5432);
      setSvcDestPort(5432);
      setHcProtocol("http");
      setHcPort(8008);
      setHcInterval(5);
      setHcTimeout(3);
      setHcRetries(3);
      setHcPath("/leader");
      setHcStatuses("200");
      setHcTls(false);
    }
    onOpenChange(val);
  };

  const handleCreate = async () => {
    if (!name || !location) {
      toast.error("Please fill in all required fields");
      return;
    }
    setCreating(true);
    try {
      await trpcClient.cluster.hetznerCreateLoadBalancer.mutate({
        name,
        location,
        loadBalancerType: lbType || undefined,
        networkId: networkId || undefined,
        algorithm: (algorithm as "round_robin" | "least_connections") || undefined,
        service: {
          protocol: svcProtocol as "tcp" | "http",
          listenPort: svcListenPort,
          destinationPort: svcDestPort,
          healthCheckProtocol: hcProtocol as "http" | "tcp",
          healthCheckPort: hcPort,
          healthCheckInterval: hcInterval,
          healthCheckTimeout: hcTimeout,
          healthCheckRetries: hcRetries,
          healthCheckPath: hcPath,
          healthCheckStatuses: hcStatuses.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
          healthCheckTls: hcTls,
        },
      });
      toast.success(`Load balancer "${name}" created successfully`);
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const loading = lbTypes.isLoading || locations.isLoading || networks.isLoading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Load Balancer</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading options...
          </div>
        )}

        {!loading && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-sm">Name</Label>
              <Input placeholder="my-load-balancer" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Type</Label>
              <Select value={lbType} onValueChange={(v) => setLbType(v ?? "")}>
                <SelectTrigger className="w-full">
                  {lbType
                    ? <span>{lbTypesData.find((t: any) => t.name === lbType)?.description || lbType}</span>
                    : <span className="text-muted-foreground">Select type (default: lb11)</span>}
                </SelectTrigger>
                <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                  {lbTypesData.map((t: any) => (
                    <SelectItem key={t.id} value={t.name}>
                      <span className="text-sm">{t.description}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({t.maxConnections} conn, {t.maxTargets} targets, €{t.priceMonthly}/mo)
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Location</Label>
              <Select value={location} onValueChange={(v) => setLocation(v ?? "")}>
                <SelectTrigger className="w-full">
                  {location
                    ? <span>{(() => { const l = locationsData.find((l: any) => l.name === location); return l ? `${l.city || l.description}, ${l.country} (${l.name})` : location; })()}</span>
                    : <span className="text-muted-foreground">Select location</span>}
                </SelectTrigger>
                <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                  {locationsData.map((l: any) => (
                    <SelectItem key={l.id} value={l.name}>
                      {l.city || l.description}, {l.country} ({l.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Network</Label>
              <Select value={networkId} onValueChange={(v) => setNetworkId(v === "__none__" ? "" : (v ?? ""))}>
                <SelectTrigger className="w-full">
                  {networkId
                    ? <span>{networksData.find((n: any) => n.id === networkId)?.name || networkId}</span>
                    : <span className="text-muted-foreground">No network (public only)</span>}
                </SelectTrigger>
                <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                  <SelectItem value="__none__">No network (public only)</SelectItem>
                  {networksData.map((n: any) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.name} ({n.ipRange}, {n.serverCount} servers)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {networksData.length === 0 && !networks.isLoading && (
                <p className="text-xs text-muted-foreground">No private networks found in your Hetzner account.</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Algorithm</Label>
              <Select value={algorithm} onValueChange={(v) => setAlgorithm(v ?? "round_robin")}>
                <SelectTrigger className="w-full">
                  {algorithm === "round_robin"
                    ? <span>Round Robin</span>
                    : <span>Least Connections</span>}
                </SelectTrigger>
                <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                  <SelectItem value="least_connections">Least Connections</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Service</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Protocol</Label>
                  <Select value={svcProtocol} onValueChange={(v) => setSvcProtocol(v ?? "tcp")}>
                    <SelectTrigger className="w-full"><span className="uppercase">{svcProtocol}</span></SelectTrigger>
                    <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="http">HTTP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Listen Port</Label>
                  <Input type="number" value={svcListenPort} onChange={(e) => setSvcListenPort(Number(e.target.value))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Destination Port</Label>
                  <Input type="number" value={svcDestPort} onChange={(e) => setSvcDestPort(Number(e.target.value))} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Health Check</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Protocol</Label>
                  <Select value={hcProtocol} onValueChange={(v) => setHcProtocol(v ?? "http")}>
                    <SelectTrigger className="w-full"><span className="uppercase">{hcProtocol}</span></SelectTrigger>
                    <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Port</Label>
                  <Input type="number" value={hcPort} onChange={(e) => setHcPort(Number(e.target.value))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Interval (s)</Label>
                  <Input type="number" value={hcInterval} onChange={(e) => setHcInterval(Number(e.target.value))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Timeout (s)</Label>
                  <Input type="number" value={hcTimeout} onChange={(e) => setHcTimeout(Number(e.target.value))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Retries</Label>
                  <Input type="number" value={hcRetries} onChange={(e) => setHcRetries(Number(e.target.value))} />
                </div>
                {hcProtocol === "http" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Path</Label>
                    <Input value={hcPath} onChange={(e) => setHcPath(e.target.value)} />
                  </div>
                )}
                {hcProtocol === "http" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">TLS</Label>
                    <Select value={hcTls ? "enabled" : "disabled"} onValueChange={(v) => setHcTls(v === "enabled")}>
                      <SelectTrigger className="w-full">
                        <span>{hcTls ? "Enabled" : "Disabled"}</span>
                      </SelectTrigger>
                      <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {hcProtocol === "http" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Status Codes</Label>
                    <Input value={hcStatuses} onChange={(e) => setHcStatuses(e.target.value)} placeholder="2??, 3??" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={!name || !location || creating}
          >
            {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
