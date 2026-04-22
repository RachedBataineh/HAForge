"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { ArrowLeft, Loader2, Globe, Server, Network, HardDrive } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React from "react";

import { trpc } from "@/utils/trpc";

export default function NetworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: networkId } = React.use(params);
  const router = useRouter();

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const apiToken = profile.data?.hetznerApiToken || "";

  const net = useQuery(
    trpc.network.details.queryOptions(
      { apiToken, networkId },
      { enabled: !!apiToken && !!networkId },
    ),
  );

  if (!apiToken) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Add your Hetzner API token in Settings first.</p>
      </div>
    );
  }

  if (net.isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading network details...
      </div>
    );
  }

  const data = net.data;

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Network not found.</p>
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
              {data.protection && <Badge variant="outline">Protected</Badge>}
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{data.ipRange}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">ID</span>
                <p className="font-mono">{data.id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">IP Range</span>
                <p className="font-mono">{data.ipRange}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created</span>
                <p>{new Date(data.created).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Routes to vSwitch</span>
                <p>{data.exposeRoutesToVswitch ? "Enabled" : "Disabled"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subnets */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="size-4" />
              Subnets ({data.subnets.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.subnets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subnets configured.</p>
            ) : (
              <div className="space-y-2">
                {data.subnets.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <Network className="size-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium font-mono">{s.ipRange}</p>
                        <p className="text-xs text-muted-foreground">Gateway: {s.gateway}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{s.type}</Badge>
                      <span className="text-xs text-muted-foreground">{s.networkZone}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Routes */}
        {data.routes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Routes ({data.routes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.routes.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm font-mono">{r.destination}</span>
                    <span className="text-xs text-muted-foreground">via {r.gateway}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Connected Servers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="size-4" />
              Servers ({data.servers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.servers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No servers attached to this network.</p>
            ) : (
              <div className="space-y-2">
                {data.servers.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => router.push(`/dashboard/servers/hetzner-${s.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <HardDrive className="size-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{s.publicIp || "No public IP"}</p>
                      </div>
                    </div>
                    <Badge variant={s.status === "running" ? "default" : "secondary"}>
                      {s.status === "running" ? "Running" : s.status === "off" ? "Off" : s.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
