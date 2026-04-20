"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@HAForge/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Server,
  Plus,
  Database,
  Activity,
  CheckCircle2,
  AlertCircle,
  Globe,
  Trash2,
  Network,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { trpc, trpcClient } from "@/utils/trpc";
import { DeleteClusterDialog } from "./delete-cluster-dialog";

const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  configuring: "default",
  deploying: "default",
  running: "default",
  error: "destructive",
  destroyed: "outline",
};

const statusIcon: Record<string, typeof CheckCircle2> = {
  running: CheckCircle2,
  deploying: Activity,
  error: AlertCircle,
  draft: Server,
};

function ClusterCard({ cluster }: { cluster: any }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const Icon = statusIcon[cluster.status] || Server;
  const clusterServers = cluster.servers ?? [];
  const pg = clusterServers.filter((s: any) => s.role?.startsWith("postgresql")).length;
  const ha = clusterServers.filter((s: any) => s.role?.startsWith("haproxy")).length;

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => router.push(`/dashboard/clusters/${cluster.id}`)}
    >
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">{cluster.name}</CardTitle>
            <CardDescription className="flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1">
                <Database className="size-3" />
                {pg} PostgreSQL
              </span>
              {cluster.clusterType === "hetzner_lb" ? (
                <span className="flex items-center gap-1">
                  <Network className="size-3" />
                  {cluster.loadBalancerId ? "1" : "0"} Load Balancer
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Globe className="size-3" />
                  {ha} HAProxy
                </span>
              )}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusColor[cluster.status] || "outline"}>
            {cluster.status}
          </Badge>
          {cluster.status === "draft" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
            </Button>
          )}
        </div>
      </CardHeader>

      <div onClick={(e) => e.stopPropagation()}>
        <DeleteClusterDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          clusterName={cluster.name}
          onConfirm={() => {
            trpcClient.cluster.delete.mutate({ id: cluster.id }).then(() => {
              queryClient.invalidateQueries(trpc.cluster.list.queryFilter());
            });
          }}
        />
      </div>
    </Card>
  );
}

export default function ClusterListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newClusterName, setNewClusterName] = useState("");
  const [newClusterType, setNewClusterType] = useState<"haproxy" | "hetzner_lb">("haproxy");

  const [activeTab, setActiveTab] = useState<"active" | "draft">("active");

  const clusters = useQuery(trpc.cluster.list.queryOptions());

  const activeClusters = (clusters.data ?? []).filter((c: any) => c.status !== "draft");
  const draftClusters = (clusters.data ?? []).filter((c: any) => c.status === "draft");

  const createCluster = useMutation({
    mutationFn: async ({ name, type }: { name: string; type: "haproxy" | "hetzner_lb" }) => {
      return await trpcClient.cluster.create.mutate({ name, clusterType: type });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(trpc.cluster.list.queryFilter());
      setDialogOpen(false);
      setNewClusterName("");
      setNewClusterType("haproxy");
      router.push(`/dashboard/clusters/${data.id}`);
    },
  });


  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clusters</h1>
        <p className="text-muted-foreground">
          Manage your PostgreSQL HA clusters
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center border-b gap-1">
        <div className="flex gap-1">
          {([
            { id: "active" as const, label: "Active Clusters" },
            { id: "draft" as const, label: "Draft Clusters" },
          ]).map((tab) => {
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
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto">
          <Button size="sm" className="gap-2 mb-1" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            New Cluster
          </Button>
        </div>
      </div>

      {clusters.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading clusters...
          </CardContent>
        </Card>
      )}

      {clusters.data && clusters.data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Database className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">
              No clusters yet. Create your first HA cluster.
            </p>
          </CardContent>
        </Card>
      )}

      {clusters.data && clusters.data.length > 0 && activeTab === "active" && (
        activeClusters.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Database className="size-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">No active clusters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {activeClusters.map((cluster: any) => (
              <ClusterCard key={cluster.id} cluster={cluster} />
            ))}
          </div>
        )
      )}

      {clusters.data && clusters.data.length > 0 && activeTab === "draft" && (
        draftClusters.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Server className="size-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">No draft clusters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {draftClusters.map((cluster: any) => (
              <ClusterCard key={cluster.id} cluster={cluster} />
            ))}
          </div>
        )
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Cluster</DialogTitle>
            <DialogDescription>
              Choose your cluster type and enter a name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Cluster Type</Label>
              <div className="grid grid-cols-2 gap-3">
                <Card
                  className={`cursor-pointer transition-colors ${newClusterType === "haproxy" ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
                  onClick={() => setNewClusterType("haproxy")}
                >
                  <CardContent className="py-3 text-center">
                    <p className="font-medium text-sm">HAProxy</p>
                    <p className="text-xs text-muted-foreground mt-1">3 PG + 3 HAProxy</p>
                  </CardContent>
                </Card>
                <Card
                  className={`cursor-pointer transition-colors ${newClusterType === "hetzner_lb" ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
                  onClick={() => setNewClusterType("hetzner_lb")}
                >
                  <CardContent className="py-3 text-center">
                    <p className="font-medium text-sm">Hetzner LB</p>
                    <p className="text-xs text-muted-foreground mt-1">3 PG + Load Balancer</p>
                  </CardContent>
                </Card>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Cluster Name</Label>
              <Input
                id="name"
                placeholder="my-ha-cluster"
                value={newClusterName}
                onChange={(e) => setNewClusterName(e.target.value)}
              />
            </div>
            <Button
              onClick={() => createCluster.mutate({ name: newClusterName, type: newClusterType })}
              disabled={!newClusterName.trim() || createCluster.isPending}
            >
              {createCluster.isPending ? "Creating..." : "Create Cluster"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
