"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Power, PowerOff, RotateCw, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

export default function HetznerTab({ server }: { server: any }) {
  const queryClient = useQueryClient();

  const hetznerInfo = useQuery(
    trpc.cluster.hetznerServerInfo.queryOptions(
      { apiToken: server.clusterHetznerToken || "", serverId: server.hetznerServerId || "" },
      { enabled: !!server.hetznerServerId && !!server.clusterHetznerToken },
    ),
  );

  const serverAction = useMutation({
    mutationFn: async (action: "poweron" | "poweroff" | "reboot") => {
      return await trpcClient.cluster.hetznerServerAction.mutate({
        apiToken: server.clusterHetznerToken,
        serverId: server.hetznerServerId,
        action,
      });
    },
    onSuccess: (_, action) => {
      toast.success(`Server ${action} initiated`);
      setTimeout(() => queryClient.invalidateQueries(trpc.cluster.hetznerServerInfo.queryFilter()), 3000);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (!server.hetznerServerId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No Hetzner server ID linked to this server.
        </CardContent>
      </Card>
    );
  }

  if (!server.clusterHetznerToken) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No Hetzner API token available for this cluster.
        </CardContent>
      </Card>
    );
  }

  if (hetznerInfo.isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Fetching Hetzner server info...
        </CardContent>
      </Card>
    );
  }

  if (hetznerInfo.isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          Failed to fetch Hetzner server info.
        </CardContent>
      </Card>
    );
  }

  const info = hetznerInfo.data!;
  const trafficUsed = ((info.outgoingTraffic + info.ingoingTraffic) / 1024 / 1024 / 1024).toFixed(1);
  const trafficLimit = (info.includedTraffic / 1024 / 1024 / 1024).toFixed(0);

  return (
    <div className="space-y-6">
      {/* Server Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Server Details
            <Badge variant={info.status === "running" ? "default" : "destructive"}>
              {info.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Name</span>
              <p className="font-mono">{info.name}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Server Type</span>
              <p>{info.serverType}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Location</span>
              <p>{info.location} ({info.datacenter})</p>
            </div>
            <div>
              <span className="text-muted-foreground">vCPUs</span>
              <p>{info.cores}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Memory</span>
              <p>{info.memory} GB</p>
            </div>
            <div>
              <span className="text-muted-foreground">Disk</span>
              <p>{info.disk} GB</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p>{new Date(info.created).toLocaleDateString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Rescue Mode</span>
              <p>{info.rescueEnabled ? "Enabled" : "Disabled"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Backups</span>
              <p>{info.backupWindow ? `Window: ${info.backupWindow}` : "Disabled"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Traffic */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Traffic</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Used</span>
              <p>{trafficUsed} GB</p>
            </div>
            <div>
              <span className="text-muted-foreground">Included</span>
              <p>{trafficLimit === "0" ? "Unlimited" : `${trafficLimit} GB`}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Power Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Power Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => serverAction.mutate("poweron")}
              disabled={serverAction.isPending}
            >
              {serverAction.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Power className="size-4 mr-2" />}
              Power On
            </Button>
            <Button
              variant="outline"
              onClick={() => serverAction.mutate("reboot")}
              disabled={serverAction.isPending}
            >
              {serverAction.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <RotateCw className="size-4 mr-2" />}
              Reboot
            </Button>
            <Button
              variant="destructive"
              onClick={() => serverAction.mutate("poweroff")}
              disabled={serverAction.isPending}
            >
              {serverAction.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <PowerOff className="size-4 mr-2" />}
              Power Off
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Actions are sent via the Hetzner Cloud API.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
