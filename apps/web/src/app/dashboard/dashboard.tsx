"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Button } from "@HAForge/ui/components/button";
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
import { Server, Activity, CheckCircle2, AlertCircle, Plus } from "lucide-react";
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

export default function DashboardContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newClusterName, setNewClusterName] = useState("");

  const clusters = useQuery(trpc.cluster.list.queryOptions());
  const clusterList = clusters.data ?? [];

  const runningCount = clusterList.filter((c: any) => c.status === "running").length;
  const deployingCount = clusterList.filter((c: any) => c.status === "deploying").length;
  const errorCount = clusterList.filter((c: any) => c.status === "error").length;

  const createCluster = useMutation({
    mutationFn: async (name: string) => {
      return await trpcClient.cluster.create.mutate({ name });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(trpc.cluster.list.queryFilter());
      setDialogOpen(false);
      setNewClusterName("");
      router.push(`/dashboard/clusters/${data.id}`);
    },
  });

  const stats = [
    {
      title: "Total Clusters",
      value: clusterList.length,
      icon: Server,
      description: "All clusters",
    },
    {
      title: "Running",
      value: runningCount,
      icon: CheckCircle2,
      description: "Healthy clusters",
    },
    {
      title: "Deploying",
      value: deployingCount,
      icon: Activity,
      description: "In progress",
    },
    {
      title: "Errors",
      value: errorCount,
      icon: AlertCircle,
      description: "Needs attention",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your PostgreSQL HA clusters
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
                Enter a name for your new PostgreSQL HA cluster. You&apos;ll configure the 6 servers
                (3 PostgreSQL + 3 HAProxy) in the next step.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
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
                onClick={() => createCluster.mutate(newClusterName)}
                disabled={!newClusterName.trim() || createCluster.isPending}
              >
                {createCluster.isPending ? "Creating..." : "Create Cluster"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Clusters</h2>
        {clusters.isLoading && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading clusters...
            </CardContent>
          </Card>
        )}
        {clusterList.length === 0 && !clusters.isLoading && (
          <Card>
            <CardContent className="py-12 text-center">
              <Server className="size-12 text-muted-foreground/30 mx-auto mb-4" />
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
        {clusterList.length > 0 && (
          <div className="grid gap-3">
            {clusterList.map((cluster: any) => {
              const Icon = statusIcon[cluster.status] || Server;
              return (
                <Card
                  key={cluster.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() =>
                    router.push(`/dashboard/clusters/${cluster.id}`)
                  }
                >
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <Icon className="size-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{cluster.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {cluster.servers?.length || 0} servers
                        </p>
                      </div>
                    </div>
                    <Badge variant={statusColor[cluster.status] || "outline"}>
                      {cluster.status}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
