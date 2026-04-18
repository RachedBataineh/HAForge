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
import { Textarea } from "@HAForge/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { trpc, trpcClient } from "@/utils/trpc";

export default function ClusterListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newClusterName, setNewClusterName] = useState("");

  const clusters = useQuery(trpc.cluster.list.queryOptions());

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

  const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    draft: "secondary",
    configuring: "default",
    deploying: "default",
    running: "default",
    error: "destructive",
    destroyed: "outline",
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Clusters</h1>
          <p className="text-muted-foreground mt-1">Manage your PostgreSQL HA clusters</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            + New Cluster
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Cluster</DialogTitle>
              <DialogDescription>
                Enter a name for your new PostgreSQL HA cluster. You'll configure the 6 servers
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

      {clusters.isLoading && <p>Loading clusters...</p>}

      {clusters.data && clusters.data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No clusters yet. Create your first HA cluster.</p>
          </CardContent>
        </Card>
      )}

      {clusters.data && clusters.data.length > 0 && (
        <div className="grid gap-4">
          {clusters.data.map((cluster: any) => (
            <Card
              key={cluster.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/clusters/${cluster.id}`)}
            >
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{cluster.name}</CardTitle>
                  <CardDescription>
                    {cluster.servers?.length || 0} servers
                  </CardDescription>
                </div>
                <Badge variant={statusColor[cluster.status] || "outline"}>
                  {cluster.status}
                </Badge>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
