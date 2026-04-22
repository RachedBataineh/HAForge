"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { ArrowLeft, Loader2, Network, Trash2, ExternalLink, Server } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

export default function LoadBalancerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: lbId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const apiToken = profile.data?.hetznerApiToken || "";

  const lb = useQuery(
    trpc.cluster.hetznerLoadBalancerDetails.queryOptions(
      { apiToken, loadBalancerId: lbId },
      { enabled: !!apiToken && !!lbId },
    ),
  );

  if (!apiToken) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Add your Hetzner API token in Settings first.</p>
      </div>
    );
  }

  if (lb.isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading load balancer details...
      </div>
    );
  }

  const data = lb.data;

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Load balancer not found.</p>
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
              <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
              <Badge variant="secondary">{data.type}</Badge>
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{data.publicIp}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Location</span>
                <p>{data.location}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Type</span>
                <p>{data.type}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Algorithm</span>
                <p className="capitalize">{data.algorithm || "round_robin"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created</span>
                <p>{new Date(data.created).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Public IP</span>
                <p className="font-mono">{data.publicIp}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Private IP</span>
                <p className="font-mono">{data.privateIp || "N/A"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Services */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Services</CardTitle>
          </CardHeader>
          <CardContent>
            {data.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">No services configured.</p>
            ) : (
              <div className="space-y-3">
                {data.services.map((s: any, i: number) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Protocol</span>
                        <p className="uppercase">{s.protocol}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Listen Port</span>
                        <p className="font-mono">{s.listenPort}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Destination Port</span>
                        <p className="font-mono">{s.destinationPort}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Health Check</span>
                        <p>{s.healthCheckProtocol}:{s.healthCheckPort}{s.healthCheckPath ? ` ${s.healthCheckPath}` : ""}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Targets */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="size-4" />
              Targets ({data.targets.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No targets attached. Add servers via the cluster wizard.</p>
            ) : (
              <div className="space-y-2">
                {data.targets.map((t: any, i: number) => {
                  const isLeader = t.status === "5432: healthy";
                  const isRunning = t.serverStatus === "running";
                  const role = isLeader ? "Leader" : (isRunning ? "Replica" : "Server Offline");

                  return (
                    <div key={i} className="flex items-center justify-between rounded-lg border p-3"
                      onClick={() => t.serverId && router.push(`/dashboard/servers/hetzner-${t.serverId}`)}
                      style={{ cursor: t.serverId ? "pointer" : "default" }}
                    >
                      <div className="flex items-center gap-3">
                        <Server className="size-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm font-medium">{t.serverName || `Server ${t.serverId}`}</span>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground font-mono">{t.serverIp}</span>
                            <span className="text-xs text-muted-foreground">
                              {isRunning ? "Running" : t.serverStatus === "off" ? "Off" : t.serverStatus}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Badge variant={isLeader ? "default" : "secondary"}>{role}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
