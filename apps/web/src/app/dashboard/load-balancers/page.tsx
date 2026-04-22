"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Network, Plus, Loader2, Trash2, ExternalLink } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { trpc, trpcClient } from "@/utils/trpc";

export default function LoadBalancersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLb, setDeleteLb] = useState<{ id: string; name: string } | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const apiToken = profile.data?.hetznerApiToken || "";

  const loadBalancers = useQuery(
    trpc.cluster.hetznerLoadBalancers.queryOptions(
      { apiToken },
      { enabled: !!apiToken },
    ),
  );

  const lbTypes = useQuery(
    trpc.cluster.hetznerLoadBalancerTypes.queryOptions(
      { apiToken },
      { enabled: !!apiToken && createOpen },
    ),
  );

  const locations = useQuery(
    trpc.cluster.hetznerLocations.queryOptions(
      { apiToken },
      { enabled: !!apiToken && createOpen },
    ),
  );

  const lbList = (loadBalancers.data ?? []) as any[];

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      return await trpcClient.cluster.hetznerDeleteLoadBalancer.mutate({ apiToken, loadBalancerId: id });
    },
    onSuccess: () => {
      toast.success("Load balancer deleted");
      queryClient.invalidateQueries(trpc.cluster.hetznerLoadBalancers.queryFilter());
      setDeleteOpen(false);
      setDeleteLb(null);
      setDeleteName("");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (!apiToken) {
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

      {loadBalancers.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin mx-auto mb-2" />
            Loading load balancers...
          </CardContent>
        </Card>
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
        apiToken={apiToken}
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
  open, onOpenChange, apiToken, lbTypes, locations, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  apiToken: string;
  lbTypes: any;
  locations: any;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [lbType, setLbType] = useState("");
  const [location, setLocation] = useState("");
  const [creating, setCreating] = useState(false);

  const lbTypesData = (lbTypes.data ?? []) as any[];
  const locationsData = (locations.data ?? []) as any[];

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setName("");
      setLbType("");
      setLocation("");
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
        apiToken,
        name,
        location,
        loadBalancerType: lbType || undefined,
      });
      toast.success(`Load balancer "${name}" created successfully`);
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const loading = lbTypes.isLoading || locations.isLoading;

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
                <SelectTrigger>
                  {lbType
                    ? <span>{lbTypesData.find((t: any) => t.name === lbType)?.description || lbType}</span>
                    : <span className="text-muted-foreground">Select type (default: lb11)</span>}
                </SelectTrigger>
                <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                  {lbTypesData.map((t: any) => (
                    <SelectItem key={t.id} value={t.name}>
                      <span className="text-sm">{t.description}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({t.maxConnections} conn, {t.maxTargets} targets, {t.priceMonthly}/mo)
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Location</Label>
              <Select value={location} onValueChange={(v) => setLocation(v ?? "")}>
                <SelectTrigger>
                  {location
                    ? <span>{locationsData.find((l: any) => l.id === location)?.name || location}</span>
                    : <span className="text-muted-foreground">Select location</span>}
                </SelectTrigger>
                <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                  {locationsData.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} ({l.country})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              A PostgreSQL service (port 5432) with Patroni health checks will be auto-configured. You can add target servers later via the wizard.
            </p>
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
