"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import { HardDrive, Database, Server, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { trpc } from "@/utils/trpc";
import { CreateServerDialog } from "./create-server-dialog";

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
  const [activeTab, setActiveTab] = useState<"cluster" | "hetzner">("cluster");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const servers = useQuery(trpc.cluster.allServers.queryOptions());
  const serverList = (servers.data ?? []) as any[];

  const hetznerServers = useQuery(trpc.cluster.allHetznerServers.queryOptions());

  const assigned = serverList.filter((s: any) => s.clusterStatus === "running" || s.clusterStatus === "deploying");
  const draft = serverList.filter((s: any) => s.clusterStatus === "draft");

  const hzData = hetznerServers.data as { servers: any[]; apiToken: string } | undefined;
  const hzServers = hzData?.servers ?? [];
  const hzApiToken = hzData?.apiToken || "";
  const hzUsed = hzServers.filter((s) => s.used);
  const hzAvailable = hzServers.filter((s) => !s.used);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Servers</h1>
        <p className="text-muted-foreground">
          Manage servers across your clusters and Hetzner account
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold">{serverList.length}</div>
            <p className="text-xs text-muted-foreground">Cluster Servers</p>
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
            <div className="text-2xl font-bold text-blue-600">{hzAvailable.length}</div>
            <p className="text-xs text-muted-foreground">Available (Hetzner)</p>
          </CardContent>
        </Card>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center border-b gap-1">
        <div className="flex gap-1">
          {([
            { id: "cluster" as const, label: "Cluster Servers", icon: Database },
            { id: "hetzner" as const, label: "Hetzner Servers", icon: HardDrive },
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
        <div className="ml-auto">
          {hzApiToken && activeTab === "hetzner" && (
            <Button size="sm" className="gap-2 mb-1" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="size-4" />
              Create Server
            </Button>
          )}
        </div>
      </div>

      {/* Cluster Servers Tab */}
      {activeTab === "cluster" && (
        <>
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
                <Database className="size-12 text-muted-foreground/30 mx-auto mb-4" />
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
                      <Server className="size-4 text-muted-foreground" />
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
        </>
      )}

      {/* Hetzner Servers Tab */}
      {activeTab === "hetzner" && (
        <>
          {hetznerServers.isLoading && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Loading Hetzner servers...
              </CardContent>
            </Card>
          )}

          {hzAvailable.length === 0 && !hetznerServers.isLoading && (
            <Card>
              <CardContent className="py-12 text-center">
                <HardDrive className="size-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {hzUsed.length > 0
                    ? "All Hetzner servers are already assigned to clusters."
                    : "No Hetzner servers found. Create a cluster with an API token to see your servers."}
                </p>
              </CardContent>
            </Card>
          )}

          {hzAvailable.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Available</p>
              <div className="grid gap-3">
                {hzAvailable.map((server: any) => (
                  <Card key={server.id}>
                    <CardContent className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3">
                        <Server className="size-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{server.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {server.publicIp}
                            {server.privateIps?.length > 0 && (
                              <span className="ml-2">({server.privateIps[0]})</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{server.location}</span>
                        <Badge variant={server.status === "running" ? "secondary" : "destructive"}>
                          {server.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <CreateServerDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        apiToken={hzApiToken}
        onCreated={() => hetznerServers.refetch()}
      />
    </div>
  );
}
