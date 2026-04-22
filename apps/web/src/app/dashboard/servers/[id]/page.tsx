"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Switch } from "@HAForge/ui/components/switch";
import { ArrowLeft, Loader2, RotateCw, HardDrive, Terminal as TerminalIcon, KeyRound } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";
import OverviewTab from "./overview";
import Terminal from "./terminal";
import SshKeyTab from "./ssh-key-tab";
import { PowerActionDialog } from "./power-action-dialog";

const roleLabel: Record<string, string> = {
  postgresql_1: "PostgreSQL Node 1",
  postgresql_2: "PostgreSQL Node 2",
  postgresql_3: "PostgreSQL Node 3",
  haproxy_1: "HAProxy Node 1",
  haproxy_2: "HAProxy Node 2",
  haproxy_3: "HAProxy Node 3",
};

export default function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: serverId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogAction, setDialogAction] = useState<"poweroff" | "reboot" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "terminal" | "sshkey">("overview");

  const isHetznerOnly = serverId.startsWith("hetzner-");
  const hetznerId = isHetznerOnly ? serverId.replace("hetzner-", "") : null;

  // DB server data
  const servers = useQuery(trpc.cluster.allServers.queryOptions());
  const dbServer = ((servers.data ?? []) as any[]).find((s: any) => s.id === serverId);

  // Hetzner-only: look up by hetzner server ID in DB
  const dbServerByHetzner = useQuery(
    trpc.server.getByHetznerId.queryOptions(
      { hetznerServerId: hetznerId || "" },
      { enabled: isHetznerOnly && !!hetznerId },
    ),
  );

  // Hetzner API info
  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = !!profile.data?.hetznerApiToken;

  const hetznerInfo = useQuery(
    trpc.cluster.hetznerServerInfo.queryOptions(
      { serverId: dbServer?.hetznerServerId || hetznerId || "" },
      { enabled: !!(dbServer?.hetznerServerId || hetznerId) },
    ),
  );

  const serverIsOn = hetznerInfo.data?.status === "running";

  // Determine effective server record
  const hetznerPrivateIp = hetznerInfo.data?.privateIps?.[0] || "";
  const server = isHetznerOnly
    ? (dbServerByHetzner.data
        ? { ...dbServerByHetzner.data, ipAddress: hetznerInfo.data?.publicIp || dbServerByHetzner.data.ipAddress, privateIpAddress: hetznerPrivateIp || dbServerByHetzner.data.privateIpAddress, hetznerServerId: hetznerId }
        : { id: serverId, ipAddress: hetznerInfo.data?.publicIp || "", privateIpAddress: hetznerPrivateIp, hetznerServerId: hetznerId, sshKeyId: null, sshUser: "root", sshPort: 22, role: "", clusterId: "", clusterName: "" })
    : dbServer;

  const serverAction = useMutation({
    mutationFn: async (action: "poweron" | "poweroff" | "reboot") => {
      return await trpcClient.cluster.hetznerServerAction.mutate({
        serverId: server?.hetznerServerId || hetznerId || "",
        action,
      });
    },
    onSuccess: (_, action) => {
      toast.success(`Server ${action === "poweron" ? "power on" : action === "poweroff" ? "power off" : "reboot"} initiated`);
      let attempts = 0;
      const maxAttempts = 15;
      const interval = setInterval(() => {
        attempts++;
        queryClient.invalidateQueries(trpc.cluster.hetznerServerInfo.queryFilter());
        if (attempts >= maxAttempts) clearInterval(interval);
      }, 2000);
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (!server && !isHetznerOnly) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Server not found</p>
      </div>
    );
  }

  const displayName = hetznerInfo.data?.name || server?.ipAddress || hetznerId || serverId;

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
              <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
              {server?.role && <Badge variant="secondary">{roleLabel[server.role] || server.role}</Badge>}
            </div>
            {server?.clusterName && (
              <p className="text-muted-foreground mt-1">
                Cluster: <button onClick={() => router.push(`/dashboard/clusters/${server.clusterId}`)} className="underline hover:no-underline">{server.clusterName}</button>
              </p>
            )}
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

      {/* Tab Bar */}
      <div className="flex border-b px-6 gap-1">
        {([
          { id: "overview" as const, label: "Overview", icon: HardDrive },
          { id: "terminal" as const, label: "Terminal", icon: TerminalIcon },
          { id: "sshkey" as const, label: "SSH Key", icon: KeyRound },
        ]).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
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
        {activeTab === "overview" && server && <OverviewTab server={server} serverIsOn={serverIsOn} hetznerInfo={hetznerInfo.data} />}
        {activeTab === "terminal" && server && <Terminal serverId={server.id} serverIsOn={serverIsOn} />}
        {activeTab === "sshkey" && (
          <SshKeyTab
            hetznerServerId={server?.hetznerServerId || hetznerId || ""}
            currentSshKeyId={server?.sshKeyId || null}
            ipAddress={server?.ipAddress || ""}
            privateIpAddress={server?.privateIpAddress || ""}
          />
        )}
      </div>

      <PowerActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={dialogAction ?? "poweroff"}
        serverName={displayName}
        onConfirm={() => serverAction.mutate(dialogAction ?? "poweroff")}
      />
    </div>
  );
}
