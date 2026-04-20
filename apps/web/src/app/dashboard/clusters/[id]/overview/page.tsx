"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@HAForge/ui/components/card";
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
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

const ROLE_LABELS: Record<string, { label: string; type: string }> = {
  postgresql_1: { label: "PostgreSQL Node 1", type: "Primary" },
  postgresql_2: { label: "PostgreSQL Node 2", type: "Replica" },
  postgresql_3: { label: "PostgreSQL Node 3", type: "Replica" },
  haproxy_1: { label: "HAProxy Node 1", type: "Master" },
  haproxy_2: { label: "HAProxy Node 2", type: "Backup" },
  haproxy_3: { label: "HAProxy Node 3", type: "Backup" },
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

  const isLb = cluster.data?.clusterType === "hetzner_lb";
  const servers = cluster.data?.servers ?? [];
  const pgServers = servers.filter((s: any) => s.role?.startsWith("postgresql"));
  const haServers = servers.filter((s: any) => s.role?.startsWith("haproxy"));

  const deleteCluster = async () => {
    if (!confirm("Are you sure you want to delete this cluster? This cannot be undone.")) return;
    await trpcClient.cluster.delete.mutate({ id: clusterId });
    toast.success("Cluster deleted");
    router.push("/dashboard/clusters");
  };

  const startDeployment = async () => {
    const data = await trpcClient.execution.start.mutate({ clusterId });
    router.push(`/dashboard/clusters/${clusterId}/deploy?executionId=${data.executionId}`);
  };

  if (!cluster.data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const connectionHost = isLb
    ? cluster.data.loadBalancerId
      ? "Load Balancer IP"
      : ""
    : cluster.data.floatingIp || "";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={startDeployment}>
            <RotateCcw className="size-4 mr-2" />
            Redeploy
          </Button>
          <Button variant="destructive" size="icon" onClick={deleteCluster}>
            <Trash2 className="size-4" />
          </Button>
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
            <CardContent className="py-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Host</span>
                  <p className="font-mono">{connectionHost}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Port</span>
                  <p className="font-mono">5432</p>
                </div>
                <div>
                  <span className="text-muted-foreground">User</span>
                  <p className="font-mono">postgres</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Password</span>
                  <div className="flex items-center gap-1">
                    <p className="font-mono">
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

      {/* PostgreSQL Servers */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Database className="size-5" />
          PostgreSQL Nodes
        </h2>
        <div className="grid gap-3">
          {pgServers.map((server: any) => {
            const roleInfo = ROLE_LABELS[server.role] || { label: server.role, type: "" };
            return (
              <Card key={server.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="size-4 text-green-500" />
                    <div>
                      <p className="font-medium text-sm">{roleInfo.label}</p>
                      <p className="text-xs text-muted-foreground font-mono">{server.ipAddress}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {server.privateIpAddress && (
                      <span className="text-xs text-muted-foreground">
                        Private: <code>{server.privateIpAddress}</code>
                      </span>
                    )}
                    <Badge variant="secondary" className="text-xs">{roleInfo.type}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* HAProxy Servers or Load Balancer */}
      {isLb ? (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Cloud className="size-5" />
            Hetzner Load Balancer
          </h2>
          {cluster.data.loadBalancerId ? (
            <Card>
              <CardContent className="py-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Load Balancer ID</span>
                    <p className="font-mono">{cluster.data.loadBalancerId}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Service</span>
                    <p className="font-mono">TCP :5432 → :5432</p>
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  Targets: {pgServers.length} PostgreSQL nodes with Patroni health checks
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground">
                  Load Balancer will be configured during deployment.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Globe className="size-5" />
            HAProxy Nodes
          </h2>
          <div className="grid gap-3">
            {haServers.map((server: any) => {
              const roleInfo = ROLE_LABELS[server.role] || { label: server.role, type: "" };
              return (
                <Card key={server.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="size-4 text-green-500" />
                      <div>
                        <p className="font-medium text-sm">{roleInfo.label}</p>
                        <p className="text-xs text-muted-foreground font-mono">{server.ipAddress}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {server.privateIpAddress && (
                        <span className="text-xs text-muted-foreground">
                          Private: <code>{server.privateIpAddress}</code>
                        </span>
                      )}
                      {server.hetznerServerId && (
                        <span className="text-xs text-muted-foreground">
                          Hetzner ID: <code>{server.hetznerServerId}</code>
                        </span>
                      )}
                      <Badge variant="secondary" className="text-xs">{roleInfo.type}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
