"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@HAForge/ui/components/card";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Input } from "@HAForge/ui/components/input";
import {
  Database,
  Globe,
  CheckCircle2,
  Trash2,
  RotateCcw,
  Eye,
  EyeOff,
  Copy,
  Plug,
  Cloud,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  ArrowUpDown,
  Crown,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

const ROLE_LABELS: Record<string, { label: string; defaultType: string }> = {
  postgresql_1: { label: "PostgreSQL Node 1", defaultType: "Node" },
  postgresql_2: { label: "PostgreSQL Node 2", defaultType: "Node" },
  postgresql_3: { label: "PostgreSQL Node 3", defaultType: "Node" },
  haproxy_1: { label: "HAProxy Node 1", defaultType: "Node" },
  haproxy_2: { label: "HAProxy Node 2", defaultType: "Node" },
  haproxy_3: { label: "HAProxy Node 3", defaultType: "Node" },
};

const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  configuring: "default",
  deploying: "default",
  running: "default",
  error: "destructive",
  destroyed: "outline",
};

export default function ClusterOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const cluster = useQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));
  const [showPassword, setShowPassword] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  const pgRoles = useQuery(
    trpc.cluster.pgNodeRoles.queryOptions(
      { clusterId },
      { enabled: cluster.data?.status === "running", refetchInterval: 30000 },
    ),
  );

  const isLb = cluster.data?.clusterType === "hetzner_lb";
  const floatingIpDetails = useQuery(
    trpc.floatingIp.details.queryOptions(
      { floatingIpId: cluster.data?.floatingIpId || "" },
      { enabled: !isLb && !!cluster.data?.floatingIpId },
    ),
  );
  const servers = cluster.data?.servers ?? [];
  const pgServers = servers.filter((s: any) => s.role?.startsWith("postgresql"));
  const haServers = servers.filter((s: any) => s.role?.startsWith("haproxy"));

  const [destroyOpen, setDestroyOpen] = useState(false);
  const [destroyConfirm, setDestroyConfirm] = useState("");
  const [destroyMode, setDestroyMode] = useState<"delete" | "clean">("delete");
  const [redeployOpen, setRedeployOpen] = useState(false);

  const destroyCluster = useMutation({
    mutationFn: async () => {
      const result = await trpcClient.cluster.destroyCluster.mutate({ clusterId });
      return result as any;
    },
    onSuccess: (data) => {
      const failed = (data?.results || []).filter((r: any) => r.status === "failed");
      if (failed.length > 0) {
        toast.warning(`Cluster destroyed with ${failed.length} warnings`);
      } else {
        toast.success("Cluster and all servers destroyed");
      }
      router.push("/dashboard/clusters");
    },
    onError: (err) => toast.error(`Destroy failed: ${err.message}`),
  });

  const cleanCluster = useMutation({
    mutationFn: async () => {
      const result = await trpcClient.cluster.cleanCluster.mutate({ clusterId });
      return result as any;
    },
    onSuccess: (data) => {
      const failed = (data?.results || []).filter((r: any) => r.status === "failed");
      if (failed.length > 0) {
        toast.warning(`Cluster cleaned with ${failed.length} warnings`);
      } else {
        toast.success("Cluster removed — servers wiped clean");
      }
      router.push("/dashboard/servers");
    },
    onError: (err) => toast.error(`Clean failed: ${err.message}`),
  });

  const deleteDraft = async () => {
    await trpcClient.cluster.delete.mutate({ id: clusterId });
    toast.success("Draft cluster deleted");
    router.push("/dashboard/clusters");
  };

  const startDeployment = async () => {
    const data = await trpcClient.execution.start.mutate({ clusterId });
    router.push(`/dashboard/clusters/${clusterId}/deploy?executionId=${data.executionId}`);
  };

  if (!cluster.data) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const connectionHost = isLb
    ? cluster.data.loadBalancerIp || ""
    : cluster.data.floatingIp || "";
  const pgUrl = `postgresql://${cluster.data.superuserUsername || "postgres"}:${cluster.data.superuserPassword}@${connectionHost}:5432/postgres`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/dashboard/clusters")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{cluster.data.name}</h1>
            <Badge variant={statusColor[cluster.data.status] || "outline"}>
              {cluster.data.status}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {isLb ? "Hetzner LB" : "HAProxy"}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            {servers.length} servers configured
          </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setRedeployOpen(true)}>
            <RotateCcw className="size-4" />
            Redeploy
          </Button>
          {cluster.data.status === "draft" ? (
            <Button variant="destructive" size="icon" onClick={deleteDraft}>
              <Trash2 className="size-4" />
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => setDestroyOpen(true)}>
              <AlertTriangle className="size-4 mr-2" />
              Destroy
            </Button>
          )}
        </div>
      </div>

      {/* Connection Info */}
      {cluster.data.status === "running" && connectionHost && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Plug className="size-5" />
            Connection Info
          </h2>
          <Card>
            <CardContent className="py-4 space-y-4">
              <div className="text-sm">
                <span className="text-muted-foreground">PostgreSQL URL</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <p className="font-mono break-all">
                    {showUrl ? pgUrl : "•".repeat(pgUrl.length)}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowUrl(!showUrl)}
                  >
                    {showUrl ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => { navigator.clipboard.writeText(pgUrl); toast.success("URL copied"); }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Host</span>
                  <div className="flex items-center gap-1">
                    <p className="font-mono">{connectionHost}</p>
                    <Button variant="ghost" size="icon-sm" onClick={() => { navigator.clipboard.writeText(connectionHost); toast.success("Host copied"); }}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Port</span>
                  <div className="flex items-center gap-1">
                    <p className="font-mono">5432</p>
                    <Button variant="ghost" size="icon-sm" onClick={() => { navigator.clipboard.writeText("5432"); toast.success("Port copied"); }}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Username</span>
                  <div className="flex items-center gap-1">
                    <p className="font-mono">{cluster.data.superuserUsername || "postgres"}</p>
                    <Button variant="ghost" size="icon-sm" onClick={() => { navigator.clipboard.writeText(cluster.data.superuserUsername || "postgres"); toast.success("User copied"); }}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Database</span>
                  <div className="flex items-center gap-1">
                    <p className="font-mono">postgres</p>
                    <Button variant="ghost" size="icon-sm" onClick={() => { navigator.clipboard.writeText("postgres"); toast.success("Database copied"); }}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Password</span>
                  <div className="flex items-center gap-1 flex-wrap">
                    <p className="font-mono break-all">
                      {showPassword ? (cluster.data.superuserPassword || "N/A") : "••••••••"}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        navigator.clipboard.writeText(cluster.data?.superuserPassword || "");
                        toast.success("Password copied");
                      }}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Hetzner Load Balancer (LB mode only) */}
      {isLb && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Cloud className="size-5" />
            Load Balancer
          </h2>
          {cluster.data?.loadBalancerId ? (
            <Card className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/load-balancers/${cluster.data!.loadBalancerId}`)}
            >
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Cloud className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{(pgRoles.data as any)?.lbName || `LB ${cluster.data!.loadBalancerId}`}</p>
                    <p className="text-xs text-muted-foreground font-mono">{cluster.data!.loadBalancerIp}</p>
                  </div>
                </div>
                <Badge variant="secondary">{cluster.data!.loadBalancerId}</Badge>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground">
                  Load balancer will be configured during deployment.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Floating IP & Leader (HAProxy mode only) */}
      {!isLb && cluster.data?.floatingIpId && (
        <div className="grid grid-cols-2 gap-6">
          {/* Floating IP */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <ArrowUpDown className="size-5" />
              Floating IP
            </h2>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/floating-ips/${cluster.data!.floatingIpId}`)}
            >
              <CardContent className="py-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Assigned To</span>
                    {floatingIpDetails.isLoading ? (
                      <Skeleton className="h-4 w-24 mt-1" />
                    ) : floatingIpDetails.data?.serverId ? (
                      <p className="font-mono">
                        {(pgRoles.data as any)?.serverNames?.[floatingIpDetails.data.serverId]
                          || `Server ${floatingIpDetails.data.serverId}`}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">Unassigned</p>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">IP Address</span>
                    <p className="font-mono">{cluster.data.floatingIp}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          {/* PostgreSQL Leader */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Crown className="size-5" />
              PostgreSQL Leader
            </h2>
            <Card>
              <CardContent className="py-4">
                {pgRoles.isLoading ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Server</span>
                      <Skeleton className="h-4 w-24 mt-1" />
                    </div>
                    <div>
                      <span className="text-muted-foreground">IP Address</span>
                      <Skeleton className="h-4 w-32 mt-1" />
                    </div>
                  </div>
                ) : (() => {
                  const roles = (pgRoles.data as any)?.roles || {};
                  const leaderServer = pgServers.find((s: any) => roles[s.role] === "leader");
                  if (!leaderServer) {
                    return <p className="text-sm text-muted-foreground">No leader detected</p>;
                  }
                  const leaderName = leaderServer.hetznerServerId
                    ? (pgRoles.data as any)?.serverNames?.[leaderServer.hetznerServerId] || leaderServer.cachedHostname || "Unknown"
                    : leaderServer.cachedHostname || "Unknown";
                  return (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Server</span>
                        <p className="font-medium">{leaderName}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">IP Address</span>
                        <p className="font-mono">{leaderServer.ipAddress}</p>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* HAProxy Nodes (HAProxy mode only) */}
      {!isLb && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Globe className="size-5" />
            HAProxy Nodes
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {haServers.map((server: any) => {
              const roleInfo = ROLE_LABELS[server.role] || { label: server.role, defaultType: "Node" };
              const serverName = (pgRoles.data as any)?.serverNames?.[server.hetznerServerId] || server.cachedHostname;
              const srvStatus = (pgRoles.data as any)?.serverStatus?.[server.hetznerServerId];
              const isMaster = floatingIpDetails.data?.serverId === server.hetznerServerId;
              const displayType = isMaster ? "Master" : "Backup";
              const badgeVariant = isMaster ? "default" : "secondary";
              return (
                <Card key={server.id} className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => router.push(`/dashboard/servers/${server.id}`)}
                >
                  <CardContent className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className={`size-2.5 rounded-full ${srvStatus === "running" ? "bg-green-500" : srvStatus ? "bg-red-500" : "bg-muted-foreground/30"}`} />
                      <div>
                        <p className="font-medium text-sm">{serverName || roleInfo.label}</p>
                        <p className="text-xs text-muted-foreground">{roleInfo.label}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs text-muted-foreground space-y-0.5">
                        {server.ipAddress && <p className="font-mono">Public: {server.ipAddress}</p>}
                        {server.privateIpAddress && <p className="font-mono">Private: {server.privateIpAddress}</p>}
                      </div>
                      <Badge variant={badgeVariant} className="text-xs">{displayType}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* PostgreSQL Servers */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Database className="size-5" />
          PostgreSQL Nodes
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {pgServers.map((server: any) => {
            const roleInfo = ROLE_LABELS[server.role] || { label: server.role, defaultType: "Node" };
            const serverName = (pgRoles.data as any)?.serverNames?.[server.hetznerServerId] || server.cachedHostname;
            const srvStatus = (pgRoles.data as any)?.serverStatus?.[server.hetznerServerId];
            const pgRole = (pgRoles.data as any)?.roles?.[server.role];
            const displayType = pgRole === "leader" ? "Leader" : pgRole === "replica" ? "Replica" : pgRole === "offline" ? "Offline" : "Node";
            const badgeVariant = pgRole === "leader" ? "default" : pgRole === "replica" ? "secondary" : pgRole === "offline" ? "destructive" : "outline";
            return (
              <Card key={server.id} className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => router.push(`/dashboard/servers/${server.id}`)}
              >
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className={`size-2.5 rounded-full ${srvStatus === "running" ? "bg-green-500" : srvStatus ? "bg-red-500" : "bg-muted-foreground/30"}`} />
                    <div>
                      <p className="font-medium text-sm">{serverName || roleInfo.label}</p>
                      <p className="text-xs text-muted-foreground">{roleInfo.label}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs text-muted-foreground space-y-0.5">
                      {server.ipAddress && <p className="font-mono">Public: {server.ipAddress}</p>}
                      {server.privateIpAddress && <p className="font-mono">Private: {server.privateIpAddress}</p>}
                    </div>
                    <Badge variant={badgeVariant} className="text-xs">{displayType}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Redeploy Confirmation Dialog */}
      <Dialog open={redeployOpen} onOpenChange={setRedeployOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redeploy Cluster</DialogTitle>
            <DialogDescription>
              This will wipe and reconfigure all {servers.length} servers from scratch. Existing data will be lost. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeployOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setRedeployOpen(false); startDeployment(); }}>
              <RotateCcw className="size-4 mr-2" />
              Redeploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destroy Cluster Dialog */}
      <Dialog open={destroyOpen} onOpenChange={(open) => { setDestroyOpen(open); if (!open) { setDestroyConfirm(""); setDestroyMode("delete"); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Destroy Cluster
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Mode selection */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setDestroyMode("delete")}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  destroyMode === "delete"
                    ? "border-destructive bg-destructive/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <p className="text-sm font-semibold">Delete Everything</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Destroy all Hetzner servers, LB, floating IP, and cluster data
                </p>
              </button>
              <button
                onClick={() => setDestroyMode("clean")}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  destroyMode === "clean"
                    ? "border-orange-500 bg-orange-500/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <p className="text-sm font-semibold">Clean & Rebuild</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Keep servers but wipe them with a fresh OS image. Delete cluster data
                </p>
              </button>
            </div>

            {/* What will happen */}
            {destroyMode === "delete" ? (
              <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 space-y-2">
                <p className="text-sm font-medium text-destructive">All of the following will be permanently deleted:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  {servers.map((s: any) => (
                    <li key={s.id}>
                      Server: {s.ipAddress || s.hetznerServerId || s.id}
                      {s.hetznerServerId ? " (Hetzner VM)" : " (DB only)"}
                    </li>
                  ))}
                  {isLb && cluster.data.loadBalancerId && (
                    <li>Load Balancer: {cluster.data.loadBalancerIp || cluster.data.loadBalancerId}</li>
                  )}
                  {!isLb && cluster.data.floatingIp && (
                    <li>Floating IP: {cluster.data.floatingIp}</li>
                  )}
                  <li>All cluster data, execution history, and logs</li>
                </ul>
              </div>
            ) : (
              <div className="rounded-md bg-orange-500/5 border border-orange-500/20 p-3 space-y-2">
                <p className="text-sm font-medium text-orange-600 dark:text-orange-400">Servers will be wiped clean with a fresh OS:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  {servers.filter((s: any) => s.hetznerServerId).map((s: any) => (
                    <li key={s.id}>
                      Server {s.ipAddress || s.hetznerServerId} — rebuilt with Ubuntu 24.04
                    </li>
                  ))}
                  {servers.some((s: any) => !s.hetznerServerId) && (
                    <li>{servers.filter((s: any) => !s.hetznerServerId).length} DB-only server(s) removed from records</li>
                  )}
                  {isLb && cluster.data.loadBalancerId && (
                    <li>Load Balancer: {cluster.data.loadBalancerIp || cluster.data.loadBalancerId} — deleted</li>
                  )}
                  {!isLb && cluster.data.floatingIp && (
                    <li>Floating IP: {cluster.data.floatingIp} — released</li>
                  )}
                  <li>All cluster data, execution history, and logs — deleted</li>
                </ul>
                <p className="text-xs text-muted-foreground mt-2">
                  Servers will remain in your Hetzner account with a clean Ubuntu installation. You can reassign them to a new cluster.
                </p>
              </div>
            )}

            <p className="text-sm">
              Type <span className="font-mono font-semibold bg-muted px-1.5 py-0.5 rounded">{cluster.data.name}</span> to confirm:
            </p>
            <Input
              placeholder={cluster.data.name}
              value={destroyConfirm}
              onChange={(e) => setDestroyConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && destroyConfirm === cluster.data.name) {
                  if (destroyMode === "delete") destroyCluster.mutate();
                  else cleanCluster.mutate();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDestroyOpen(false); setDestroyConfirm(""); }}>
              Cancel
            </Button>
            {destroyMode === "delete" ? (
              <Button
                variant="destructive"
                disabled={destroyConfirm !== cluster.data.name || destroyCluster.isPending}
                onClick={() => destroyCluster.mutate()}
              >
                {destroyCluster.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Trash2 className="size-4 mr-2" />}
                Delete Everything
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="bg-orange-600 hover:bg-orange-700"
                disabled={destroyConfirm !== cluster.data.name || cleanCluster.isPending}
                onClick={() => cleanCluster.mutate()}
              >
                {cleanCluster.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <RotateCcw className="size-4 mr-2" />}
                Clean & Rebuild
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
