"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { ArrowUpDown, Plus, Loader2, Trash2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { trpc, trpcClient } from "@/utils/trpc";

export default function FloatingIpsPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIp, setDeleteIp] = useState<{ id: string; name: string; ip: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = !!profile.data?.hetznerApiToken;

  const floatingIps = useQuery(
    trpc.floatingIp.list.queryOptions(undefined, { enabled: hasToken }),
  );

  const ipList = (floatingIps.data ?? []) as any[];

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      return await trpcClient.floatingIp.delete.mutate({ floatingIpId: id });
    },
    onSuccess: () => {
      toast.success("Floating IP deleted");
      floatingIps.refetch();
      setDeleteOpen(false);
      setDeleteIp(null);
      setDeleteConfirm("");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (profile.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Floating IPs</h1>
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Floating IPs</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowUpDown className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Add your Hetzner API token in Settings to manage floating IPs.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Floating IPs</h1>
          <p className="text-muted-foreground">Manage Hetzner Cloud Floating IPs</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Create Floating IP
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold">{ipList.length}</div>
            <p className="text-xs text-muted-foreground">Total Floating IPs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold text-green-600">{ipList.filter((ip: any) => ip.serverId).length}</div>
            <p className="text-xs text-muted-foreground">Assigned</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold text-blue-600">{ipList.filter((ip: any) => !ip.serverId).length}</div>
            <p className="text-xs text-muted-foreground">Unassigned</p>
          </CardContent>
        </Card>
      </div>

      {floatingIps.isLoading && (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!floatingIps.isLoading && ipList.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowUpDown className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No floating IPs found. Create one to get started.</p>
          </CardContent>
        </Card>
      )}

      {ipList.length > 0 && (
        <div className="grid gap-3">
          {ipList.map((ip: any) => (
            <Card key={ip.id} className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/floating-ips/${ip.id}`)}
            >
              <CardContent className="flex items-center py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <ArrowUpDown className="size-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{ip.name || ip.ip}</p>
                    <p className="text-xs text-muted-foreground font-mono">{ip.ip}</p>
                  </div>
                </div>
                <div className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-xs text-muted-foreground">Assigned to</span>
                  {ip.serverName ? (
                    <Badge variant="outline">{ip.serverName}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Unassigned</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant={ip.type === "ipv4" ? "default" : "secondary"}>{ip.type.toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">{ip.homeLocationCity || ip.homeLocation}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteIp({ id: ip.id, name: ip.name || ip.ip, ip: ip.ip });
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
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Floating IP</DialogTitle>
          </DialogHeader>
          <CreateFloatingIpForm
            onCreated={() => {
              floatingIps.refetch();
              setCreateOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) { setDeleteIp(null); setDeleteConfirm(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Floating IP</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type <span className="font-mono font-semibold">{deleteIp?.ip}</span> to confirm deletion.
          </p>
          <Input
            placeholder={deleteIp?.ip}
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && deleteConfirm === deleteIp?.ip && deleteIp) {
                deleteMutation.mutate({ id: deleteIp.id });
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteIp(null); setDeleteConfirm(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== deleteIp?.ip || deleteMutation.isPending}
              onClick={() => { if (deleteIp) deleteMutation.mutate({ id: deleteIp.id }); }}
            >
              {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateFloatingIpForm({ onCreated }: { onCreated: () => void }) {
  const [type, setType] = useState("ipv4");
  const [location, setLocation] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const locations = useQuery(trpc.cluster.hetznerLocations.queryOptions());
  const servers = useQuery(trpc.cluster.hetznerServers.queryOptions());
  const pricing = useQuery(trpc.floatingIp.pricing.queryOptions());
  const locationsData = (locations.data ?? []) as any[];
  const serversData = (servers.data ?? []) as any[];
  const [serverId, setServerId] = useState("");

  const priceLabel = (t: string) => {
    if (!pricing.data) return t === "ipv4" ? "IPv4" : "IPv6";
    const price = t === "ipv4" ? pricing.data.ipv4 : pricing.data.ipv6;
    return t === "ipv4" ? `IPv4 — €${price}/mo` : `IPv6 — Free`;
  };

  const handleCreate = async () => {
    if (!location) { toast.error("Select a location"); return; }
    setCreating(true);
    try {
      await trpcClient.floatingIp.create.mutate({
        type: type as "ipv4" | "ipv6",
        homeLocation: location,
        name: name || undefined,
        serverId: serverId || undefined,
      });
      toast.success("Floating IP created");
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label className="text-sm">Name</Label>
          <Input placeholder="my-floating-ip" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v ?? "ipv4")}>
            <SelectTrigger className="w-full">
              <span>{priceLabel(type)}</span>
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              <SelectItem value="ipv4">{priceLabel("ipv4")}</SelectItem>
              <SelectItem value="ipv6">{priceLabel("ipv6")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Location</Label>
          <Select value={location} onValueChange={(v) => setLocation(v ?? "")}>
            <SelectTrigger className="w-full">
              {location
                ? <span>{(() => { const l = locationsData.find((l: any) => l.name === location); return l ? `${l.city}, ${l.country} (${l.name})` : location; })()}</span>
                : <span className="text-muted-foreground">Select location</span>}
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              {locationsData.map((l: any) => (
                <SelectItem key={l.id} value={l.name}>
                  {l.city}, {l.country} ({l.name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Assign to Server (optional)</Label>
          <Select value={serverId} onValueChange={(v) => setServerId(v === "__none__" ? "" : (v ?? ""))}>
            <SelectTrigger className="w-full">
              {serverId
                ? <span>{serversData.find((s: any) => s.id === serverId)?.name || serverId}</span>
                : <span className="text-muted-foreground">No assignment</span>}
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              <SelectItem value="__none__">No assignment</SelectItem>
              {serversData.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.publicIp})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCreated}>Cancel</Button>
        <Button onClick={handleCreate} disabled={!location || creating}>
          {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
          Create
        </Button>
      </DialogFooter>
    </>
  );
}
