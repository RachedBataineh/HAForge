"use client";

import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Label } from "@HAForge/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@HAForge/ui/components/select";
import { HardDrive, Loader2, Save, RotateCw, AlertCircle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";

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

export default function OverviewTab({ server }: { server: any }) {
  const queryClient = useQueryClient();
  const [selectedTz, setSelectedTz] = useState(server.cachedTimezone || "");
  const [refreshing, setRefreshing] = useState(false);
  const [hetznerStatus, setHetznerStatus] = useState<string | null>(null);

  // Check Hetzner server status in background
  const hetznerInfo = useQuery(
    trpc.cluster.hetznerServerInfo.queryOptions(
      { apiToken: server.clusterHetznerToken || "", serverId: server.hetznerServerId || "" },
      { enabled: !!server.hetznerServerId && !!server.clusterHetznerToken },
    ),
  );

  useEffect(() => {
    if (hetznerInfo.data) {
      setHetznerStatus(hetznerInfo.data.status);
    }
  }, [hetznerInfo.data]);

  // Check if cached data is stale (>5 min) and server is running → auto-refresh
  const isStale = !server.lastFetchedAt || (Date.now() - new Date(server.lastFetchedAt).getTime() > 5 * 60 * 1000);
  const serverIsRunning = hetznerStatus === "running";

  useEffect(() => {
    if (isStale && serverIsRunning && !refreshing) {
      doRefresh();
    }
  }, [serverIsRunning, isStale]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await trpcClient.cluster.refreshServerInfo.mutate({ serverId: server.id });
      queryClient.invalidateQueries(trpc.cluster.allServers.queryFilter());
    } catch {
      // Silently fail — cached data is still shown
    } finally {
      setRefreshing(false);
    }
  };

  const setTimezone = useMutation({
    mutationFn: async (timezone: string) => {
      await trpcClient.cluster.serverSetTimezone.mutate({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort || 22,
        sshUser: server.sshUser || "root",
        sshPrivateKey: server.sshPrivateKey,
        timezone,
      });
      await trpcClient.cluster.updateServerCache.mutate({ serverId: server.id, timezone });
    },
    onSuccess: () => {
      toast.success("Timezone updated");
      queryClient.invalidateQueries(trpc.cluster.allServers.queryFilter());
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const hasCachedData = !!server.cachedHostname;
  const serverOff = hetznerStatus && hetznerStatus !== "running";
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

      {/* System Information */}
      <div className="flex items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <HardDrive className="size-4" />
          System Information
        </CardTitle>
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
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Hostname</span>
                  <p className="font-mono">{server.cachedHostname}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Operating System</span>
                  <p>{server.cachedOs}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Architecture</span>
                  <p className="font-mono">{server.cachedArch}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">CPU Cores</span>
                  <p>{server.cachedCpuCores}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">RAM</span>
                  <p>{server.cachedRamMB && Number(server.cachedRamMB) >= 1024 ? `${(Number(server.cachedRamMB) / 1024).toFixed(1)} GB` : `${server.cachedRamMB} MB`}</p>
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
                    disabled={selectedTz === server.cachedTimezone || setTimezone.isPending || !serverIsRunning}
                  >
                    {setTimezone.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Save className="size-4 mr-2" />}
                    Save
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
