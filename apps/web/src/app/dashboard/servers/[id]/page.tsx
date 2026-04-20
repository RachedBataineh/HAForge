"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Switch } from "@HAForge/ui/components/switch";
import { HardDrive, ArrowLeft, Globe, Wifi, Loader2, RotateCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";
import OverviewTab from "./overview";
import ServicesTab from "./services";
import NetworkingTab from "./networking";
import { PowerActionDialog } from "./power-action-dialog";

const roleLabel: Record<string, string> = {
  postgresql_1: "PostgreSQL Node 1",
  postgresql_2: "PostgreSQL Node 2",
  postgresql_3: "PostgreSQL Node 3",
  haproxy_1: "HAProxy Node 1",
  haproxy_2: "HAProxy Node 2",
  haproxy_3: "HAProxy Node 3",
};

const tabs = [
  { id: "overview", label: "Overview", icon: HardDrive },
  { id: "services", label: "Services", icon: Globe },
  { id: "networking", label: "Networking", icon: Wifi },
] as const;

type TabId = typeof tabs[number]["id"];

export default function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: serverId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [dialogAction, setDialogAction] = useState<"poweroff" | "reboot" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const servers = useQuery(trpc.cluster.allServers.queryOptions());
  const server = ((servers.data ?? []) as any[]).find((s: any) => s.id === serverId);

  const hetznerInfo = useQuery(
    trpc.cluster.hetznerServerInfo.queryOptions(
      { apiToken: server?.clusterHetznerToken || "", serverId: server?.hetznerServerId || "" },
      { enabled: !!server?.hetznerServerId && !!server?.clusterHetznerToken },
    ),
  );

  const serverIsOn = hetznerInfo.data?.status === "running";

  const serverAction = useMutation({
    mutationFn: async (action: "poweron" | "poweroff" | "reboot") => {
      return await trpcClient.cluster.hetznerServerAction.mutate({
        apiToken: server!.clusterHetznerToken,
        serverId: server!.hetznerServerId,
        action,
      });
    },
    onSuccess: (_, action) => {
      toast.success(`Server ${action === "poweron" ? "power on" : action === "poweroff" ? "power off" : "reboot"} initiated`);
      const poll = () => {
        let attempts = 0;
        const maxAttempts = 15;
        const interval = setInterval(() => {
          attempts++;
          queryClient.invalidateQueries(trpc.cluster.hetznerServerInfo.queryFilter());
          if (attempts >= maxAttempts) clearInterval(interval);
        }, 2000);
      };
      poll();
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (!server) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Server not found</p>
      </div>
    );
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
              <h1 className="text-2xl font-bold tracking-tight">{server.ipAddress}</h1>
              <Badge variant="secondary">{roleLabel[server.role] || server.role}</Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              Cluster: <button onClick={() => router.push(`/dashboard/clusters/${server.clusterId}`)} className="underline hover:no-underline">{server.clusterName}</button>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hetznerInfo.data && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setDialogAction("reboot"); setDialogOpen(true); }}
                disabled={!serverIsOn || serverAction.isPending}
              >
                {serverAction.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
              </Button>
              <div className="flex items-center gap-2">
                <Switch
                  checked={serverIsOn}
                  disabled={serverAction.isPending}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      serverAction.mutate("poweron");
                    } else {
                      setDialogAction("poweroff");
                      setDialogOpen(true);
                    }
                  }}
                />
                <span className="text-sm">{serverIsOn ? "On" : "Off"}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Vertical Tabs */}
        <div className="w-44 border-r p-3 flex flex-col gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "overview" && <OverviewTab server={server} serverIsOn={serverIsOn} hetznerInfo={hetznerInfo.data} />}
          {activeTab === "services" && <ServicesTab server={server} />}
          {activeTab === "networking" && <NetworkingTab server={server} />}
        </div>
      </div>

      <PowerActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={dialogAction ?? "poweroff"}
        serverName={hetznerInfo.data?.name || server.ipAddress}
        onConfirm={() => serverAction.mutate(dialogAction ?? "poweroff")}
      />
    </div>
  );
}
