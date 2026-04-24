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
import { Globe, Plus, Loader2, Trash2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { trpc, trpcClient } from "@/utils/trpc";

export default function NetworksPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNet, setDeleteNet] = useState<{ id: string; name: string } | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = !!profile.data?.hetznerApiToken;

  const networks = useQuery(
    trpc.network.list.queryOptions(undefined, { enabled: hasToken }),
  );

  const netList = (networks.data ?? []) as any[];

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      return await trpcClient.network.delete.mutate({ networkId: id });
    },
    onSuccess: () => {
      toast.success("Network deleted");
      networks.refetch();
      setDeleteOpen(false);
      setDeleteNet(null);
      setDeleteName("");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (!hasToken) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Networks</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Add your Hetzner API token in Settings to manage networks.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Networks</h1>
          <p className="text-muted-foreground">Manage Hetzner Cloud Private Networks</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Create Network
        </Button>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold">{netList.length}</div>
            <p className="text-xs text-muted-foreground">Total Networks</p>
          </CardContent>
        </Card>
      </div>

      {networks.isLoading && (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!networks.isLoading && netList.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No networks found. Create one to get started.</p>
          </CardContent>
        </Card>
      )}

      {netList.length > 0 && (
        <div className="grid gap-3">
          {netList.map((n: any) => (
            <Card key={n.id} className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/networks/${n.id}`)}
            >
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Globe className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{n.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{n.ipRange}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{n.serverCount} servers</Badge>
                  {n.loadBalancerCount > 0 && (
                    <Badge variant="outline">{n.loadBalancerCount} LBs</Badge>
                  )}
                  {n.subnets?.length > 0 && (
                    <span className="text-xs text-muted-foreground">{n.subnets.length} subnet{n.subnets.length > 1 ? "s" : ""}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteNet({ id: n.id, name: n.name });
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
            <DialogTitle>Create Network</DialogTitle>
          </DialogHeader>
          <CreateNetworkForm
            existingNetworks={netList}
            onCreated={() => {
              networks.refetch();
              setCreateOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Network</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type <span className="font-mono font-semibold">{deleteNet?.name}</span> to confirm deletion.
          </p>
          <Input
            placeholder={deleteNet?.name}
            value={deleteName}
            onChange={(e) => setDeleteName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && deleteName === deleteNet?.name && deleteNet) {
                deleteMutation.mutate({ id: deleteNet.id });
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteNet(null); setDeleteName(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteName !== deleteNet?.name || deleteMutation.isPending}
              onClick={() => {
                if (deleteNet) deleteMutation.mutate({ id: deleteNet.id });
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

function CreateNetworkForm({ existingNetworks, onCreated }: { existingNetworks: any[]; onCreated: () => void }) {
  const suggestIpRange = (networks: any[]) => {
    const used = new Set<number>();
    for (const n of networks) {
      const match = n.ipRange?.match(/^10\.(\d+)\.0\.0\//);
      if (match) used.add(parseInt(match[1], 10));
    }
    for (let i = 0; i <= 255; i++) {
      if (!used.has(i)) return `10.${i}.0.0/16`;
    }
    return "10.0.0.0/16";
  };

  const [name, setName] = useState("");
  const [ipRange, setIpRange] = useState(() => suggestIpRange(existingNetworks));
  const [networkZone, setNetworkZone] = useState("eu-central");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name || !ipRange) {
      toast.error("Please fill in all fields");
      return;
    }
    setCreating(true);
    try {
      await trpcClient.network.create.mutate({ name, ipRange, networkZone });
      toast.success(`Network "${name}" created successfully`);
      setName("");
      setIpRange("10.0.0.0/16");
      setNetworkZone("eu-central");
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
          <Input placeholder="my-network" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Network Zone</Label>
          <Select value={networkZone} onValueChange={(v) => setNetworkZone(v ?? "eu-central")}>
            <SelectTrigger className="w-full">
              {networkZone === "eu-central" ? "EU Central" : networkZone === "us-east" ? "US East" : networkZone === "us-west" ? "US West" : "AP Southeast"}
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              <SelectItem value="eu-central">EU Central</SelectItem>
              <SelectItem value="us-east">US East</SelectItem>
              <SelectItem value="us-west">US West</SelectItem>
              <SelectItem value="ap-southeast">AP Southeast</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">The zone where the network will be created.</p>
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">IP Range (CIDR)</Label>
          <Input placeholder="10.0.0.0/16" value={ipRange} onChange={(e) => setIpRange(e.target.value)} />
          <p className="text-xs text-muted-foreground">The IP range for the network in CIDR notation.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onCreated()}>Cancel</Button>
        <Button onClick={handleCreate} disabled={!name || !ipRange || creating}>
          {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
          Create
        </Button>
      </DialogFooter>
    </>
  );
}
