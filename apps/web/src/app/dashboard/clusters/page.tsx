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
  DialogTrigger,
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
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { trpc, trpcClient } from "@/utils/trpc";

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

export default function ClusterListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newClusterName, setNewClusterName] = useState("");
  const [newClusterType, setNewClusterType] = useState<"haproxy" | "hetzner_lb">("haproxy");

  const clusters = useQuery(trpc.cluster.list.queryOptions());

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

  const pgCount = (servers: any[]) =>
    servers?.filter((s: any) => s.role?.startsWith("postgresql")).length ?? 0;
  const haCount = (servers: any[]) =>
    servers?.filter((s: any) => s.role?.startsWith("haproxy")).length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clusters</h1>
          <p className="text-muted-foreground">
            Manage your PostgreSQL HA clusters
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="size-4 mr-2" />
            New Cluster
          </DialogTrigger>
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
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4 mr-2" />
              New Cluster
            </Button>
          </CardContent>
        </Card>
      )}

      {clusters.data && clusters.data.length > 0 && (
        <div className="grid gap-4">
          {clusters.data.map((cluster: any) => {
            const Icon = statusIcon[cluster.status] || Server;
            const servers = cluster.servers ?? [];
            const pg = pgCount(servers);
            const ha = haCount(servers);

            return (
              <Card
                key={cluster.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() =>
                  router.push(`/dashboard/clusters/${cluster.id}`)
                }
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
                        <span className="flex items-center gap-1">
                          <Globe className="size-3" />
                          {ha} HAProxy
                        </span>
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
                          if (confirm("Delete this draft cluster?")) {
                            trpcClient.cluster.delete.mutate({ id: cluster.id }).then(() => {
                              queryClient.invalidateQueries(trpc.cluster.list.queryFilter());
                            });
                          }
                        }}
                      >
                        <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
