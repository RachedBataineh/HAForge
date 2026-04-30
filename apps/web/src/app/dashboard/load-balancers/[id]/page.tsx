"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import { Separator } from "@HAForge/ui/components/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@HAForge/ui/components/select";
import { ArrowLeft, Loader2, Server, Save } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

export default function LoadBalancerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: lbId } = React.use(params);
  const router = useRouter();

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = profile.data?.hasHetznerToken ?? false;

  const lb = useQuery(
    trpc.cluster.hetznerLoadBalancerDetails.queryOptions(
      { loadBalancerId: lbId },
      { enabled: hasToken && !!lbId },
    ),
  );

  // Editable state
  const [algorithm, setAlgorithm] = useState("");
  const [svcProtocol, setSvcProtocol] = useState("tcp");
  const [svcListenPort, setSvcListenPort] = useState(5432);
  const [svcDestPort, setSvcDestPort] = useState(5432);
  const [hcProtocol, setHcProtocol] = useState("http");
  const [hcPort, setHcPort] = useState(8008);
  const [hcInterval, setHcInterval] = useState(5);
  const [hcTimeout, setHcTimeout] = useState(3);
  const [hcRetries, setHcRetries] = useState(3);
  const [hcPath, setHcPath] = useState("/leader");
  const [hcTls, setHcTls] = useState(false);
  const [hcStatuses, setHcStatuses] = useState("200");
  const [dirty, setDirty] = useState(false);

  // Populate state from fetched data
  useEffect(() => {
    if (lb.data) {
      setAlgorithm(lb.data.algorithm || "round_robin");
      if (lb.data.services.length > 0) {
        const s = lb.data.services[0];
        setSvcProtocol(s.protocol || "tcp");
        setSvcListenPort(s.listenPort || 5432);
        setSvcDestPort(s.destinationPort || 5432);
        setHcProtocol(s.healthCheckProtocol || "http");
        setHcPort(s.healthCheckPort || 8008);
        setHcInterval(s.healthCheckInterval || 5);
        setHcTimeout(s.healthCheckTimeout || 3);
        setHcRetries(s.healthCheckRetries || 3);
        setHcPath(s.healthCheckPath || "/leader");
        setHcTls(s.healthCheckTls || false);
        setHcStatuses((s.healthCheckStatuses && s.healthCheckStatuses.length > 0 ? s.healthCheckStatuses : ["200"]).join(", "));
      }
    }
  }, [lb.data]);

  const markDirty = () => setDirty(true);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await trpcClient.cluster.hetznerUpdateLoadBalancer.mutate({
        loadBalancerId: lbId,
        algorithm: algorithm as "round_robin" | "least_connections",
        service: {
          protocol: svcProtocol as "tcp" | "http",
          listenPort: svcListenPort,
          destinationPort: svcDestPort,
          healthCheckProtocol: hcProtocol as "http" | "tcp",
          healthCheckPort: hcPort,
          healthCheckInterval: hcInterval,
          healthCheckTimeout: hcTimeout,
          healthCheckRetries: hcRetries,
          healthCheckPath: hcPath,
          healthCheckTls: hcTls,
          healthCheckStatuses: hcStatuses.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
        },
      });
    },
    onSuccess: () => {
      toast.success("Load balancer updated successfully");
      setDirty(false);
      lb.refetch();
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update load balancer");
    },
  });

  if (profile.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Add your Hetzner API token in Settings first.</p>
      </div>
    );
  }

  if (lb.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
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
        {/* Details */}
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
                <Label className="text-muted-foreground text-xs">Algorithm</Label>
                <Select value={algorithm} onValueChange={(v) => { setAlgorithm(v ?? "round_robin"); markDirty(); }}>
                  <SelectTrigger className="w-full mt-1 h-8">
                    <span>{algorithm === "round_robin" ? "Round Robin" : "Least Connections"}</span>
                  </SelectTrigger>
                  <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                    <SelectItem value="round_robin">Round Robin</SelectItem>
                    <SelectItem value="least_connections">Least Connections</SelectItem>
                  </SelectContent>
                </Select>
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

        {/* Services - Editable */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Protocol</Label>
                <Select value={svcProtocol} onValueChange={(v) => { setSvcProtocol(v ?? "tcp"); markDirty(); }}>
                  <SelectTrigger className="w-full"><span className="uppercase">{svcProtocol}</span></SelectTrigger>
                  <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="http">HTTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Listen Port</Label>
                <Input type="number" value={svcListenPort} onChange={(e) => { setSvcListenPort(Number(e.target.value)); markDirty(); }} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Destination Port</Label>
                <Input type="number" value={svcDestPort} onChange={(e) => { setSvcDestPort(Number(e.target.value)); markDirty(); }} />
              </div>
            </div>

            <Separator />

            <div>
              <Label className="text-sm font-semibold">Health Check</Label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Protocol</Label>
                  <Select value={hcProtocol} onValueChange={(v) => { setHcProtocol(v ?? "http"); markDirty(); }}>
                    <SelectTrigger className="w-full"><span className="uppercase">{hcProtocol}</span></SelectTrigger>
                    <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Port</Label>
                  <Input type="number" value={hcPort} onChange={(e) => { setHcPort(Number(e.target.value)); markDirty(); }} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Interval (s)</Label>
                  <Input type="number" value={hcInterval} onChange={(e) => { setHcInterval(Number(e.target.value)); markDirty(); }} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Timeout (s)</Label>
                  <Input type="number" value={hcTimeout} onChange={(e) => { setHcTimeout(Number(e.target.value)); markDirty(); }} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Retries</Label>
                  <Input type="number" value={hcRetries} onChange={(e) => { setHcRetries(Number(e.target.value)); markDirty(); }} />
                </div>
                {hcProtocol === "http" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Path</Label>
                    <Input value={hcPath} onChange={(e) => { setHcPath(e.target.value); markDirty(); }} />
                  </div>
                )}
                {hcProtocol === "http" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">TLS</Label>
                    <Select value={hcTls ? "enabled" : "disabled"} onValueChange={(v) => { setHcTls(v === "enabled"); markDirty(); }}>
                      <SelectTrigger className="w-full">
                        <span>{hcTls ? "Enabled" : "Disabled"}</span>
                      </SelectTrigger>
                      <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {hcProtocol === "http" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Status Codes</Label>
                    <Input value={hcStatuses} onChange={(e) => { setHcStatuses(e.target.value); markDirty(); }} placeholder="2??, 3??" />
                  </div>
                )}
              </div>
            </div>
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
                  const role = isLeader ? "Leader" : (isRunning ? "Replica" : "Offline");

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

        {/* Save Button */}
        {dirty && (
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Save className="size-4 mr-2" />}
              Save Changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
