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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { trpcClient } from "@/utils/trpc";

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
          <CardContent className="py-8 text-center text-muted-foreground">
            No system info available yet. Deploy this server first or click refresh.
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

      {hasCachedData && (
        <>
          {/* Hetzner Plan Info (from API) */}
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

          {/* Live System Info (from SSH) */}
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

          {/* Timezone & Danger Zone */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                        This will permanently destroy the Hetzner server and all its data. This action cannot be undone.
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
                <p className="text-sm text-muted-foreground">
                  This will permanently destroy the server <span className="font-semibold text-foreground">{hetznerInfo?.name || server.ipAddress}</span> and all its data. This action cannot be undone.
                </p>
                <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-sm text-destructive">
                  All data on this server will be permanently lost, including databases, configurations, and files.
                </div>
                <p className="text-sm">
                  Type <span className="font-mono font-semibold bg-muted px-1.5 py-0.5 rounded">{hetznerInfo?.name || server.ipAddress}</span> to confirm:
                </p>
                <Input
                  placeholder={hetznerInfo?.name || server.ipAddress}
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    const expected = hetznerInfo?.name || server.ipAddress;
                    if (e.key === "Enter" && deleteConfirm === expected) {
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
                  disabled={deleteConfirm !== (hetznerInfo?.name || server.ipAddress) || deleteServer.isPending}
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
