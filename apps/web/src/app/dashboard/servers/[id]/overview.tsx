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
import { HardDrive, Loader2, Save } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  const [selectedTz, setSelectedTz] = useState("");
  const [detailsLoaded, setDetailsLoaded] = useState(false);

  const details = useQuery(
    trpc.cluster.serverDetails.queryOptions(
      {
        ipAddress: server.ipAddress || "",
        sshPort: server.sshPort || 22,
        sshUser: server.sshUser || "root",
        sshPrivateKey: server.sshPrivateKey || "",
      },
      { enabled: !!server.sshPrivateKey && server.clusterStatus !== "draft" },
    ),
  );

  useEffect(() => {
    if (details.data && !detailsLoaded) {
      setSelectedTz(details.data.timezone);
      setDetailsLoaded(true);
    }
  }, [details.data, detailsLoaded]);

  const setTimezone = useMutation({
    mutationFn: async (timezone: string) => {
      return await trpcClient.cluster.serverSetTimezone.mutate({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort || 22,
        sshUser: server.sshUser || "root",
        sshPrivateKey: server.sshPrivateKey,
        timezone,
      });
    },
    onSuccess: () => {
      toast.success("Timezone updated");
      queryClient.invalidateQueries(trpc.cluster.serverDetails.queryFilter());
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const info = details.data;

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

      {/* Server Details */}
      {details.isLoading && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Fetching server details via SSH...
          </CardContent>
        </Card>
      )}

      {details.isError && (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Failed to fetch server details. Make sure SSH is accessible.
          </CardContent>
        </Card>
      )}

      {info && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="size-4" />
                System Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Hostname</span>
                  <p className="font-mono">{info.hostname}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Operating System</span>
                  <p>{info.os}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Architecture</span>
                  <p className="font-mono">{info.arch}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">CPU Cores</span>
                  <p>{info.cpuCores}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">RAM</span>
                  <p>{Number(info.ramMB) >= 1024 ? `${(Number(info.ramMB) / 1024).toFixed(1)} GB` : `${info.ramMB} MB`}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Kernel</span>
                  <p className="font-mono">{info.kernel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Uptime</span>
                  <p>{info.uptime}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Disk Usage</span>
                  <p>{info.diskUsed} / {info.diskTotal} ({info.diskPercent} used)</p>
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
                  disabled={selectedTz === info.timezone || setTimezone.isPending}
                >
                  {setTimezone.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Save className="size-4 mr-2" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
