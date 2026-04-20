"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Card, CardContent } from "@HAForge/ui/components/card";
import { HardDrive, Globe, Database } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React from "react";

import { trpc } from "@/utils/trpc";

const roleLabel: Record<string, string> = {
  postgresql_1: "PostgreSQL Node 1",
  postgresql_2: "PostgreSQL Node 2",
  postgresql_3: "PostgreSQL Node 3",
  haproxy_1: "HAProxy Node 1",
  haproxy_2: "HAProxy Node 2",
  haproxy_3: "HAProxy Node 3",
};

const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  configuring: "default",
  deploying: "default",
  running: "default",
  error: "destructive",
  destroyed: "outline",
};

export default function ServersPage() {
  const router = useRouter();
  const servers = useQuery(trpc.cluster.allServers.queryOptions());
  const serverList = (servers.data ?? []) as any[];

  const assigned = serverList.filter((s: any) => s.clusterStatus === "running" || s.clusterStatus === "deploying");
  const draft = serverList.filter((s: any) => s.clusterStatus === "draft");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Servers</h1>
        <p className="text-muted-foreground">
          All servers across your clusters
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold">{serverList.length}</div>
            <p className="text-xs text-muted-foreground">Total Servers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold text-green-600">{assigned.length}</div>
            <p className="text-xs text-muted-foreground">In Production</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold text-yellow-600">{draft.length}</div>
            <p className="text-xs text-muted-foreground">In Draft</p>
          </CardContent>
        </Card>
      </div>

      {servers.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading servers...
          </CardContent>
        </Card>
      )}

      {serverList.length === 0 && !servers.isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <HardDrive className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No servers yet. Create a cluster to add servers.</p>
          </CardContent>
        </Card>
      )}

      {serverList.length > 0 && (
        <div className="grid gap-3">
          {serverList.map((server: any) => (
            <Card
              key={server.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/servers/${server.id}`)}
            >
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <HardDrive className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">
                      {server.ipAddress}
                      {server.privateIpAddress && (
                        <span className="text-muted-foreground text-xs ml-2">
                          ({server.privateIpAddress})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {roleLabel[server.role] || server.role}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/dashboard/clusters/${server.clusterId}`);
                    }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Database className="size-3" />
                    {server.clusterName}
                  </button>
                  <Badge variant={statusColor[server.clusterStatus] || "outline"}>
                    {server.clusterStatus}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
