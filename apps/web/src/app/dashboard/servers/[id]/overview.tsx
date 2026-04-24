"use client";

import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@HAForge/ui/components/select";
import { Loader2, Save, RotateCw, AlertCircle, Trash2, AlertTriangle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { trpc, trpcClient } from "@/utils/trpc";

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Paris",
  "Europe/Helsinki",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export default function OverviewTab({ server, serverIsOn, hetznerInfo }: { server: any; serverIsOn?: boolean; hetznerInfo?: any }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedTz, setSelectedTz] = useState(server.cachedTimezone || "");
  const [refreshing, setRefreshing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [rebuildConfirm, setRebuildConfirm] = useState("");
  const [rebuildImage, setRebuildImage] = useState("ubuntu-24.04");

  const serverOff = serverIsOn === false;

  // Check if cached data is stale (>5 min) and server is running → auto-refresh
  const isStale = !server.lastFetchedAt || (Date.now() - new Date(server.lastFetchedAt).getTime() > 5 * 60 * 1000);

  useEffect(() => {
    if (isStale && !serverOff && !refreshing) {
      doRefresh();
    }
  }, [serverOff, isStale]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await trpcClient.cluster.refreshServerInfo.mutate({ serverId: server.id });
      queryClient.invalidateQueries({ queryKey: [["cluster", "allServers"]] });
    } catch {
      // Silently fail — cached data is still shown
    } finally {
      setRefreshing(false);
    }
  };

  const setTimezone = useMutation({
    mutationFn: async (timezone: string) => {
      await trpcClient.cluster.serverSetTimezone.mutate({
        serverId: server.id,
        timezone,
      });
      await trpcClient.cluster.updateServerCache.mutate({ serverId: server.id, timezone });
    },
    onSuccess: () => {
      toast.success("Timezone updated");
      queryClient.invalidateQueries({ queryKey: [["cluster", "allServers"]] });
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const deleteServer = useMutation({
    mutationFn: async () => {
      const hetznerId = server.hetznerServerId;
      if (!hetznerId) throw new Error("No Hetzner server ID");
      await trpcClient.cluster.hetznerDeleteServer.mutate({ serverId: hetznerId });
    },
    onSuccess: () => {
      toast.success("Server deleted");
      queryClient.invalidateQueries({ queryKey: [["cluster", "allServers"]] });
      queryClient.invalidateQueries({ queryKey: [["cluster", "allHetznerServers"]] });
      router.push("/dashboard/servers");
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  const destroyCluster = useMutation({
    mutationFn: async () => {
      if (!server.clusterId) throw new Error("No cluster ID");
      const result = await trpcClient.cluster.destroyCluster.mutate({ clusterId: server.clusterId });
      return result as any;
    },
    onSuccess: (data) => {
      const failed = (data?.results || []).filter((r: any) => r.status === "failed");
      if (failed.length > 0) {
        toast.warning(`Cluster destroyed with ${failed.length} warnings`);
      } else {
        toast.success("Cluster destroyed");
      }
      queryClient.invalidateQueries({ queryKey: [["cluster", "allServers"]] });
      queryClient.invalidateQueries({ queryKey: [["cluster", "allHetznerServers"]] });
      router.push("/dashboard/servers");
    },
    onError: (err) => toast.error(`Destroy failed: ${err.message}`),
  });

  const rebuildServer = useMutation({
    mutationFn: async () => {
      const hetznerId = server.hetznerServerId;
      if (!hetznerId) throw new Error("No Hetzner server ID");
      await trpcClient.cluster.hetznerRebuildServer.mutate({ serverId: hetznerId, image: rebuildImage });
    },
    onSuccess: () => {
      toast.success("Server is being rebuilt with a fresh OS. This may take a few minutes.");
      queryClient.invalidateQueries({ queryKey: [["cluster", "allServers"]] });
      queryClient.invalidateQueries({ queryKey: [["cluster", "hetznerServerInfo"]] });
      setRebuildOpen(false);
      setRebuildConfirm("");
    },
    onError: (err) => toast.error(`Rebuild failed: ${err.message}`),
  });

  const isInCluster = !!server.clusterId && server.clusterStatus !== "draft";
  const clusterLabel = server.clusterName || server.clusterId;
  const serverName = hetznerInfo?.name || server.ipAddress;

  const hasCachedData = !!server.cachedHostname;
  const lastFetched = server.lastFetchedAt
    ? new Date(server.lastFetchedAt).toLocaleString()
    : null;

  return (
    <div className="space-y-6">
      {/* Connection Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Public IP</span>
              <p className="font-mono">{server.ipAddress}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Private IP</span>
              <p className="font-mono">{server.privateIpAddress || "N/A"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">SSH User / Port</span>
              <p className="font-mono">{server.sshUser || "root"} : {server.sshPort || 22}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* No cached data states */}
      {!hasCachedData && !refreshing && (
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <div className="flex flex-col items-center gap-2">
              {serverOff ? (
                <>
                  <AlertCircle className="size-8 text-muted-foreground/40" />
                  <p className="text-muted-foreground">Server is powered off.</p>
                  <p className="text-xs text-muted-foreground">System info will be available after the server is turned on and refreshed.</p>
                </>
              ) : (
                <>
                  <RotateCw className="size-8 text-muted-foreground/40" />
                  <p className="text-muted-foreground">System info has not been fetched yet.</p>
                  <Button variant="outline" size="sm" onClick={doRefresh} disabled={refreshing}>
                    <RotateCw className="size-3.5 mr-2" />
                    Fetch System Info
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {refreshing && !hasCachedData && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Fetching system info...
          </CardContent>
        </Card>
      )}

      {/* Hetzner Plan Info (from API — always available) */}
      {hetznerInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Server Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Name</span>
                <p>{hetznerInfo.name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">vCPUs</span>
                <p>{hetznerInfo.cores}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Memory</span>
                <p>{hetznerInfo.memory} GB</p>
              </div>
              <div>
                <span className="text-muted-foreground">Disk</span>
                <p>{hetznerInfo.disk} GB</p>
              </div>
              <div>
                <span className="text-muted-foreground">Server Type</span>
                <p>{hetznerInfo.serverType}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Location</span>
                <p>{hetznerInfo.location} ({hetznerInfo.datacenter})</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created</span>
                <p>{new Date(hetznerInfo.created).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Traffic</span>
                <p>{hetznerInfo.includedTraffic === 0
                  ? `${((hetznerInfo.outgoingTraffic + hetznerInfo.ingoingTraffic) / 1073741824).toFixed(1)} GB / Unlimited`
                  : `${((hetznerInfo.outgoingTraffic + hetznerInfo.ingoingTraffic) / 1073741824).toFixed(1)} / ${(hetznerInfo.includedTraffic / 1073741824).toFixed(0)} GB`}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Rescue Mode</span>
                <p>{hetznerInfo.rescueEnabled ? "Enabled" : "Disabled"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Backups</span>
                <p>{hetznerInfo.backupWindow ? `Enabled (${hetznerInfo.backupWindow})` : "Disabled"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hasCachedData && (
        <>
          {/* Hetzner Plan Info was moved above to show even without cached data */}
          {/* (kept section for Live System Info below) */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Live System Info</CardTitle>
                <div className="flex items-center gap-2">
                  {lastFetched && (
                    <span className="text-xs text-muted-foreground">
                      Updated {lastFetched}
                    </span>
                  )}
                  <Button variant="outline" size="sm" onClick={doRefresh} disabled={refreshing}>
                    {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                  </Button>
                </div>
              </div>
            </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Operating System</span>
                  <p>{server.cachedOs}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Architecture</span>
                  <p className="font-mono">{server.cachedArch}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Kernel</span>
                  <p className="font-mono">{server.cachedKernel}</p>
                </div>
                {!serverOff && (
                  <div>
                    <span className="text-muted-foreground">Uptime</span>
                    <p>{server.cachedUptime}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Disk Usage</span>
                  <p>{server.cachedDiskUsed} / {server.cachedDiskTotal} ({server.cachedDiskPercent} used)</p>
                </div>
                </div>
            </CardContent>
          </Card>

          {/* Timezone, Rebuild & Danger Zone */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Timezone */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timezone</CardTitle>
              </CardHeader>
              <CardContent>
                {serverOff ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <AlertCircle className="size-4" />
                    Server must be running to change timezone.
                  </div>
                ) : (
                  <div className="flex items-end justify-between gap-4">
                    <div className="grid gap-1.5 max-w-xs">
                      <Label className="text-xs">Current Timezone</Label>
                      <Select value={selectedTz} onValueChange={(val: string | null) => setSelectedTz(val ?? "")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="!w-auto min-w-[260px]" side="bottom">
                          {COMMON_TIMEZONES.map((tz) => (
                            <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => setTimezone.mutate(selectedTz)}
                      disabled={selectedTz === server.cachedTimezone || setTimezone.isPending}
                    >
                      {setTimezone.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Save className="size-4 mr-2" />}
                      Save
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rebuild */}
            {server.hetznerServerId && (
              <Card className="border-orange-500/30">
                <CardHeader>
                  <CardTitle className="text-base text-orange-600 dark:text-orange-400 flex items-center gap-2">
                    <RotateCw className="size-4" />
                    Rebuild
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium">Wipe & reinstall OS</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Rebuilds the server with a fresh image. All data will be erased.
                      </p>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Image</Label>
                      <ImageSelect value={rebuildImage} onChange={setRebuildImage} />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-orange-500/40 text-orange-600 hover:bg-orange-500/10 hover:text-orange-700"
                      onClick={() => setRebuildOpen(true)}
                      disabled={rebuildServer.isPending}
                    >
                      <RotateCw className="size-3.5" />
                      Rebuild Server
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Danger Zone */}
            {server.hetznerServerId && (
              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="text-base text-destructive flex items-center gap-2">
                    <AlertTriangle className="size-4" />
                    Danger Zone
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium">Delete this server</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Permanently destroy the Hetzner server and all its data.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      onClick={() => setDeleteOpen(true)}
                      disabled={deleteServer.isPending}
                    >
                      <Trash2 className="size-3.5" />
                      Delete Server
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Rebuild Confirmation Dialog */}
          <Dialog open={rebuildOpen} onOpenChange={(open) => { setRebuildOpen(open); if (!open) setRebuildConfirm(""); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <RotateCw className="size-5" />
                  Rebuild Server
                </DialogTitle>
              </DialogHeader>
              <RebuildForm
                serverName={serverName}
                selectedImage={rebuildImage}
                onImageChange={setRebuildImage}
                confirmValue={rebuildConfirm}
                onConfirmChange={setRebuildConfirm}
                onConfirm={() => rebuildServer.mutate()}
                onCancel={() => { setRebuildOpen(false); setRebuildConfirm(""); }}
                isPending={rebuildServer.isPending}
              />
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteConfirm(""); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="size-5" />
                  Delete Server
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {isInCluster && (
                  <div className="rounded-md bg-orange-500/10 border border-orange-500/20 p-3 space-y-2">
                    <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
                      This server is part of an active cluster
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Deleting <span className="font-semibold text-foreground">{serverName}</span> from cluster <span className="font-semibold text-foreground">{clusterLabel}</span> will break the cluster. The PostgreSQL quorum requires all nodes to be healthy.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 mt-1"
                      onClick={() => {
                        setDeleteOpen(false);
                        setDeleteConfirm("");
                        router.push(`/dashboard/clusters/${server.clusterId}/overview`);
                      }}
                    >
                      Go to Cluster instead
                    </Button>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  This will permanently destroy the server <span className="font-semibold text-foreground">{serverName}</span> and all its data. This action cannot be undone.
                </p>
                <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-sm text-destructive">
                  All data on this server will be permanently lost, including databases, configurations, and files.
                </div>
                <p className="text-sm">
                  Type <span className="font-mono font-semibold bg-muted px-1.5 py-0.5 rounded">{serverName}</span> to confirm:
                </p>
                <Input
                  placeholder={serverName}
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && deleteConfirm === serverName) {
                      deleteServer.mutate();
                    }
                  }}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteConfirm(""); }}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleteConfirm !== serverName || deleteServer.isPending}
                  onClick={() => deleteServer.mutate()}
                >
                  {deleteServer.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Trash2 className="size-4 mr-2" />}
                  Delete Server
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function ImageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const images = useQuery(trpc.cluster.hetznerImages.queryOptions({}));
  const imageData = (images.data ?? []) as any[];

  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? "ubuntu-24.04")}>
      <SelectTrigger className="w-full">
        {value
          ? <span>{imageData.find((i: any) => i.name === value)?.description || value}</span>
          : <span className="text-muted-foreground">Select an image</span>}
      </SelectTrigger>
      <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
        {imageData.map((i: any) => (
          <SelectItem key={i.id} value={i.name}>
            {i.description} ({i.os} {i.version})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RebuildForm({ serverName, selectedImage, onImageChange, confirmValue, onConfirmChange, onConfirm, onCancel, isPending }: {
  serverName: string;
  selectedImage: string;
  onImageChange: (v: string) => void;
  confirmValue: string;
  onConfirmChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-muted-foreground">
        This will wipe <span className="font-semibold text-foreground">{serverName}</span> and install a fresh OS. All data will be erased.
      </p>
      <div className="grid gap-2">
        <Label className="text-sm">Image</Label>
        <ImageSelect value={selectedImage} onChange={onImageChange} />
      </div>
      <div className="rounded-md bg-orange-500/5 border border-orange-500/20 p-3 space-y-1">
        <p className="text-sm font-medium text-orange-600 dark:text-orange-400">What happens:</p>
        <ul className="text-sm text-muted-foreground list-disc list-inside">
          <li>Server is powered off</li>
          <li>Disk is wiped and the selected image is installed</li>
          <li>Server powers back on automatically</li>
          <li>Cached system info is cleared</li>
        </ul>
      </div>
      <p className="text-sm">
        Type <span className="font-mono font-semibold bg-muted px-1.5 py-0.5 rounded">{serverName}</span> to confirm:
      </p>
      <Input
        placeholder={serverName}
        value={confirmValue}
        onChange={(e) => onConfirmChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && confirmValue === serverName) onConfirm();
        }}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          className="bg-orange-600 hover:bg-orange-700 text-white"
          disabled={confirmValue !== serverName || isPending}
          onClick={onConfirm}
        >
          {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <RotateCw className="size-4 mr-2" />}
          Rebuild Server
        </Button>
      </DialogFooter>
    </div>
  );
}
