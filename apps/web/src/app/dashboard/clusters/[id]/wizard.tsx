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
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@HAForge/ui/components/select";
import { Progress } from "@HAForge/ui/components/progress";
import { Separator } from "@HAForge/ui/components/separator";
import {
  Network,
  Database,
  Rocket,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  KeyRound,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

const PG_ROLES = [
  { role: "postgresql_1" as const, label: "PostgreSQL", sublabel: "Node 1", num: 1 },
  { role: "postgresql_2" as const, label: "PostgreSQL", sublabel: "Node 2", num: 2 },
  { role: "postgresql_3" as const, label: "PostgreSQL", sublabel: "Node 3", num: 3 },
];

const HA_ROLES = [
  { role: "haproxy_1" as const, label: "HAProxy Node 1", sublabel: "Master", num: 1 },
  { role: "haproxy_2" as const, label: "HAProxy Node 2", sublabel: "Backup", num: 2 },
  { role: "haproxy_3" as const, label: "HAProxy Node 3", sublabel: "Backup", num: 3 },
];

interface ServerForm {
  ipAddress: string;
  sshUser: string;
  sshPort: number;
  hetznerServerId: string;
  privateIpAddress: string;
  sshKeyId: string;
}

export default function ClusterSetupWizard({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const cluster = useQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));

  const clusterType = (cluster.data?.clusterType || "haproxy") as "haproxy" | "hetzner_lb";
  const isLb = clusterType === "hetzner_lb";

  // Steps: HAProxy mode = [HAProxy Nodes, PG Nodes, Review], LB mode = [Load Balancer, PG Nodes, Review]
  const totalSteps = 3;
  const stepIcons = isLb
    ? [Network, Database, Rocket]
    : [Network, Database, Rocket];
  const stepTitles = isLb
    ? ["Load Balancer", "PostgreSQL Nodes", "Review & Deploy"]
    : ["HAProxy Nodes", "PostgreSQL Nodes", "Review & Deploy"];

  const [step, setStep] = useState(0);
  const [testingRole, setTestingRole] = useState<string | null>(null);
  const [floatingIp, setFloatingIp] = useState("");
  const [floatingIpId, setFloatingIpId] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);

  // Get Hetzner API token from user settings
  const userProfile = useQuery(trpc.settings.getProfile.queryOptions());
  const hetznerToken = userProfile.data?.hetznerApiToken || "";
  const tokenReady = hetznerToken.length > 10;

  const floatingIps = useQuery(
    trpc.cluster.hetznerFloatingIps.queryOptions(
      undefined,
      { enabled: tokenReady && !isLb },
    ),
  );
  const floatingIpList = (floatingIps.data ?? []) as any[];
  const usedFloatingIpIds = useQuery(
    trpc.cluster.usedFloatingIpIds.queryOptions(
      { excludeClusterId: clusterId },
      { enabled: !isLb },
    ),
  );
  const usedFipIdSet = new Set((usedFloatingIpIds.data ?? []) as string[]);
  const availableFloatingIps = floatingIpList.filter((ip: any) => !usedFipIdSet.has(ip.id));
  const hetznerServers = useQuery(
    trpc.cluster.hetznerServers.queryOptions(
      undefined,
      { enabled: tokenReady },
    ),
  );
  const hetznerServerList = (hetznerServers.data ?? []) as any[];

  const usedServerIds = useQuery(
    trpc.cluster.usedServerIds.queryOptions({ excludeClusterId: clusterId }),
  );
  const usedIds = new Set((usedServerIds.data ?? []) as string[]);

  const hetznerLoadBalancers = useQuery(
    trpc.cluster.hetznerLoadBalancers.queryOptions(
      undefined,
      { enabled: tokenReady && isLb },
    ),
  );
  const usedLbIds = useQuery(
    trpc.cluster.usedLoadBalancerIds.queryOptions(
      { excludeClusterId: clusterId },
      { enabled: isLb },
    ),
  );
  const usedLbIdSet = new Set((usedLbIds.data ?? []) as string[]);
  const hetznerLbList = ((hetznerLoadBalancers.data ?? []) as any[]).filter(
    (lb: any) => !usedLbIdSet.has(lb.id),
  );

  const [selectedLbId, setSelectedLbId] = useState("");
  const [createLbName, setCreateLbName] = useState("");
  const [superuserUsername, setSuperuserUsername] = useState("postgres");
  const [adminUsername, setAdminUsername] = useState("haforge");

  const [pgServers, setPgServers] = useState<Record<string, ServerForm>>({
    postgresql_1: { ipAddress: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "", sshKeyId: "" },
    postgresql_2: { ipAddress: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "", sshKeyId: "" },
    postgresql_3: { ipAddress: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "", sshKeyId: "" },
  });
  const [haServers, setHaServers] = useState<Record<string, ServerForm>>({
    haproxy_1: { ipAddress: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "", sshKeyId: "" },
    haproxy_2: { ipAddress: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "", sshKeyId: "" },
    haproxy_3: { ipAddress: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "", sshKeyId: "" },
  });

  const updateCluster = useMutation({
    mutationFn: async (data: any) => trpcClient.cluster.update.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.cluster.getById.queryFilter());
    },
  });

  const addServer = useMutation({
    mutationFn: async (data: any) => trpcClient.server.add.mutate(data),
  });

  const testConnection = useMutation({
    mutationFn: async (data: { ipAddress: string; sshPort: number; sshUser: string; sshKeyId: string }) =>
      trpcClient.server.testConnection.mutate(data),
    onSuccess: (data) => {
      if (data.success) toast.success("SSH connection successful");
      else toast.error(`Connection failed: ${data.message}`);
    },
  });

  const startDeployment = useMutation({
    mutationFn: async () => trpcClient.execution.start.mutate({ clusterId }),
    onSuccess: (data) => {
      router.push(`/dashboard/clusters/${clusterId}/deploy?executionId=${data.executionId}`);
    },
  });

  // Load saved draft data
  React.useEffect(() => {
    if (draftLoaded || !cluster.data) return;
    const c = cluster.data;
    if (c.floatingIp) setFloatingIp(c.floatingIp);
    if (c.floatingIpId) setFloatingIpId(c.floatingIpId);
    if (c.loadBalancerId) setSelectedLbId(c.loadBalancerId);
    if (c.superuserUsername) setSuperuserUsername(c.superuserUsername);
    if (c.adminUsername) setAdminUsername(c.adminUsername);

    const servers = c.servers ?? [];
    if (servers.length > 0) {
      const newPg: Record<string, ServerForm> = { ...pgServers };
      const newHa: Record<string, ServerForm> = { ...haServers };
      for (const s of servers) {
        const form: ServerForm = {
          ipAddress: s.ipAddress || "",
          sshUser: s.sshUser || "root",
          sshPort: s.sshPort || 22,
          hetznerServerId: s.hetznerServerId || "",
          privateIpAddress: s.privateIpAddress || "",
          sshKeyId: (s as any).sshKeyId || "",
        };
        if (s.role?.startsWith("postgresql")) newPg[s.role] = form;
        else if (s.role?.startsWith("haproxy")) newHa[s.role] = form;
      }
      setPgServers(newPg);
      setHaServers(newHa);
    }
    if (c.wizardStep != null && c.wizardStep > 0) {
      setStep(Math.min(c.wizardStep - 1, totalSteps - 1));
    }
    setDraftLoaded(true);
  }, [cluster.data, draftLoaded]);

  // Detect conflicts
  React.useEffect(() => {
    if (!draftLoaded || !usedServerIds.data) return;
    const used = new Set(usedServerIds.data as string[]);
    let conflict = false;

    const checkAndClear = (servers: Record<string, ServerForm>, setter: React.Dispatch<React.SetStateAction<Record<string, ServerForm>>>, roles: readonly { role: string }[]) => {
      const updated = { ...servers };
      for (const r of roles) {
        const srv = updated[r.role];
        if (srv.hetznerServerId && used.has(srv.hetznerServerId)) {
          updated[r.role] = { ipAddress: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "", sshKeyId: "" };
          conflict = true;
        }
      }
      setter(updated);
    };

    if (!isLb) checkAndClear(haServers, setHaServers, HA_ROLES);
    checkAndClear(pgServers, setPgServers, PG_ROLES);

    if (conflict) {
      if (!isLb && HA_ROLES.some((r) => !haServers[r.role]?.hetznerServerId)) setStep(0);
      else if (PG_ROLES.some((r) => !pgServers[r.role]?.hetznerServerId)) setStep(isLb ? 1 : 1);
    }
  }, [usedServerIds.data, draftLoaded]);

  // Clear selected LB if it's already used by another cluster
  React.useEffect(() => {
    if (selectedLbId && usedLbIdSet.has(selectedLbId)) setSelectedLbId("");
  }, [usedLbIds.data]);

  const saveDraft = async (currentStep: number) => {
    setDraftSaving(true);
    try {
      const clusterData: any = { id: clusterId, wizardStep: currentStep + 1 };
      if (!isLb) {
        clusterData.floatingIp = floatingIp;
        clusterData.floatingIpId = floatingIpId;
      }
      if (isLb) {
        const lb = hetznerLbList.find((l: any) => l.id === selectedLbId);
        clusterData.loadBalancerId = selectedLbId;
        clusterData.loadBalancerIp = lb?.publicIp || "";
      }
      if (currentStep >= 1) {
        clusterData.superuserUsername = superuserUsername;
        clusterData.adminUsername = adminUsername;
      }
      await updateCluster.mutateAsync(clusterData);

      const existing = cluster.data?.servers ?? [];
      for (const s of existing) {
        await trpcClient.server.remove.mutate({ id: s.id });
      }

      if (!isLb && currentStep >= 0) {
        for (const r of HA_ROLES) {
          const srv = haServers[r.role];
          if (srv.ipAddress || srv.hetznerServerId) {
            await addServer.mutateAsync({
              clusterId, ...srv, role: r.role,
              hetznerServerId: srv.hetznerServerId || undefined,
              privateIpAddress: srv.privateIpAddress || undefined,
            });
          }
        }
      }
      if (currentStep >= 1) {
        for (const r of PG_ROLES) {
          const srv = pgServers[r.role];
          if (srv.ipAddress || srv.hetznerServerId) {
            await addServer.mutateAsync({
              clusterId, ...srv, role: r.role,
              hetznerServerId: srv.hetznerServerId || undefined,
              privateIpAddress: srv.privateIpAddress || undefined,
            });
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save draft");
    } finally {
      setDraftSaving(false);
    }
  };

  const handleSaveAndDeploy = async () => {
    try {
      if (isLb) {
        const lb = hetznerLbList.find((l: any) => l.id === selectedLbId);
        await updateCluster.mutateAsync({
          id: clusterId,
          loadBalancerId: selectedLbId,
          loadBalancerIp: lb?.publicIp || "",
        });
      } else {
        await updateCluster.mutateAsync({ id: clusterId, floatingIp, floatingIpId });
      }

      // Refetch to get the latest servers list (draft may have added some)
      const fresh = await queryClient.fetchQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));
      const existingServers = fresh?.servers || [];
      for (const s of existingServers) {
        await trpcClient.server.remove.mutate({ id: s.id });
      }

      const allServers = isLb
        ? PG_ROLES.map((r) => ({ ...pgServers[r.role], role: r.role }))
        : [
            ...PG_ROLES.map((r) => ({ ...pgServers[r.role], role: r.role })),
            ...HA_ROLES.map((r) => ({ ...haServers[r.role], role: r.role })),
          ];

      for (const server of allServers) {
        await addServer.mutateAsync({
          clusterId,
          ipAddress: server.ipAddress,
          sshKeyId: server.sshKeyId || undefined,
          sshUser: server.sshUser,
          sshPort: server.sshPort,
          role: server.role,
          hetznerServerId: server.hetznerServerId || undefined,
          privateIpAddress: server.privateIpAddress || undefined,
        });
      }

      startDeployment.mutate();
    } catch (err: any) {
      toast.error(err.message || "Failed to save and deploy");
    }
  };

  const canProceed = () => {
    if (!tokenReady) return false;
    if (isLb) {
      if (step === 0) return !!selectedLbId;
      if (step === 1) return PG_ROLES.every((r) => pgServers[r.role].ipAddress && pgServers[r.role].sshKeyId);
      return true;
    }
    if (step === 0) return !!(floatingIp && floatingIpId) && HA_ROLES.every((r) => haServers[r.role].ipAddress && haServers[r.role].sshKeyId && haServers[r.role].hetznerServerId);
    if (step === 1) return PG_ROLES.every((r) => pgServers[r.role].ipAddress && pgServers[r.role].sshKeyId);
    return true;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/dashboard/clusters")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {cluster.data?.name || "Cluster Setup"}
          </h1>
        <p className="text-muted-foreground">
          {isLb ? "Configure your 3-server PostgreSQL cluster with Hetzner Load Balancer" : "Configure your 6-server HA cluster with HAProxy"}
        </p>
        </div>
      </div>

      {/* No API token warning */}
      {!tokenReady && (
        <Card className="border-destructive/50">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">
              No Hetzner API token found. Please add one in <a href="/dashboard/settings" className="underline">Settings</a> before continuing.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Progress bar */}
      <div className="space-y-3">
        <Progress value={(step / (totalSteps - 1)) * 100} className="h-1.5" />
        <div className="flex items-center justify-between">
          {stepTitles.map((title, i) => {
            const Icon = stepIcons[i];
            const isActive = i === step;
            const isDone = i < step;
            return (
              <button
                key={i}
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 text-xs transition-colors ${
                  isActive
                    ? "text-primary font-medium"
                    : isDone
                      ? "text-muted-foreground hover:text-foreground cursor-pointer"
                      : "text-muted-foreground/40"
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <Icon className="size-3.5" />
                )}
                <span className="hidden sm:inline">{title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 0: HAProxy Nodes (HAProxy mode) */}
      {step === 0 && !isLb && tokenReady && (
        <div className="grid gap-4">
          {/* Floating IP Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Floating IP</CardTitle>
              <CardDescription>Select a floating IP for HAProxy failover.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {floatingIps.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Fetching floating IPs...
                </div>
              )}
              {floatingIps.isError && (
                <p className="text-sm text-destructive">Failed to fetch floating IPs. Check your API token in Settings.</p>
              )}
              {availableFloatingIps.length > 0 && (
                <Select
                  value={floatingIpId}
                  onValueChange={(val) => {
                    const selected = availableFloatingIps.find((ip: any) => ip.id === val);
                    if (selected) {
                      setFloatingIpId(selected.id);
                      setFloatingIp(selected.ip);
                    }
                  }}
                >
                  <SelectTrigger>
                    {floatingIpId
                      ? availableFloatingIps.find((ip: any) => ip.id === floatingIpId)?.ip || floatingIpId
                      : "Select a Floating IP"}
                  </SelectTrigger>
                  <SelectContent className="!w-auto min-w-[300px]" side="bottom">
                    {availableFloatingIps.map((ip: any) => (
                      <SelectItem key={ip.id} value={ip.id}>
                        {ip.ip} {ip.name ? `(${ip.name})` : ""} - {ip.homeLocation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {availableFloatingIps.length === 0 && !floatingIps.isLoading && !floatingIps.isError && (
                <p className="text-sm text-muted-foreground">
                  No floating IPs found in your Hetzner account. Create one first.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Server fetching status */}
          {hetznerServers.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              Fetching servers from Hetzner...
            </div>
          )}
          {hetznerServers.isError && (
            <p className="text-sm text-destructive py-4">Failed to fetch servers. Check your API token in Settings.</p>
          )}

          {/* HAProxy Server Cards */}
          <div className="grid grid-cols-3 gap-4">
          {HA_ROLES.map((r) => (
            <Card key={r.role}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{r.label}</CardTitle>
                  <Badge variant="secondary">{r.sublabel}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Hetzner Server</Label>
                  <Select
                    value={haServers[r.role].hetznerServerId}
                    onValueChange={(val) => {
                      const srv = hetznerServerList.find((s: any) => s.id === val);
                      if (srv) {
                        setHaServers((prev) => ({
                          ...prev,
                          [r.role]: {
                            ...prev[r.role],
                            hetznerServerId: srv.id,
                            ipAddress: srv.publicIp,
                            privateIpAddress: srv.privateIps?.[0]?.ip || "",
                            sshKeyId: srv.sshKeyId || "",
                          },
                        }));
                      }
                    }}
                  >
                    <SelectTrigger>
                      {haServers[r.role].hetznerServerId
                        ? hetznerServerList.find((s: any) => s.id === haServers[r.role].hetznerServerId)?.name || haServers[r.role].hetznerServerId
                        : "Select a server"}
                    </SelectTrigger>
                    <SelectContent className="!w-auto min-w-[300px]" side="bottom">
                      {hetznerServerList
                        .filter((srv: any) => {
                          const currentId = haServers[r.role].hetznerServerId;
                          if (usedIds.has(srv.id) && srv.id !== currentId) return false;
                          const otherIds = HA_ROLES.filter((hr) => hr.role !== r.role)
                            .map((hr) => haServers[hr.role].hetznerServerId)
                            .filter(Boolean);
                          return srv.id === currentId || !otherIds.includes(srv.id);
                        })
                        .map((srv: any) => (
                          <SelectItem key={srv.id} value={srv.id}>
                            {srv.name} ({srv.publicIp})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                {haServers[r.role].hetznerServerId && (
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Public IP</span>
                      <p className="font-mono">{haServers[r.role].ipAddress}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Private IP</span>
                      <p className="font-mono">{haServers[r.role].privateIpAddress || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Server ID</span>
                      <p className="font-mono">{haServers[r.role].hetznerServerId}</p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">SSH User</Label>
                    <Input
                      value={haServers[r.role].sshUser}
                      onChange={(e) =>
                        setHaServers((prev) => ({
                          ...prev,
                          [r.role]: { ...prev[r.role], sshUser: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
                {haServers[r.role].sshKeyId && (
                  <div className="text-xs text-green-600 flex items-center gap-1">
                    <KeyRound className="size-3" />
                    SSH key: {hetznerServerList.find((s: any) => s.id === haServers[r.role].hetznerServerId)?.sshKeyName || "Assigned"}
                  </div>
                )}
                {!haServers[r.role].sshKeyId && haServers[r.role].hetznerServerId && (
                  <div className="text-xs text-destructive flex items-center gap-1">
                    <KeyRound className="size-3" />
                    No SSH key assigned. <a href={`/dashboard/servers/hetzner-${haServers[r.role].hetznerServerId}`} className="underline" target="_blank">Assign one</a>.
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTestingRole(r.role);
                    testConnection.mutate(
                      {
                        ipAddress: haServers[r.role].ipAddress,
                        sshPort: haServers[r.role].sshPort,
                        sshUser: haServers[r.role].sshUser,
                        sshKeyId: haServers[r.role].sshKeyId,
                      },
                      { onSettled: () => setTestingRole(null) },
                    );
                  }}
                  disabled={!haServers[r.role].ipAddress || !haServers[r.role].sshKeyId || testConnection.isPending}
                >
                  {testConnection.isPending && testingRole === r.role ? (
                    <>
                      <Loader2 className="size-3 mr-1 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    "Test Connection"
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
          </div>
        </div>
      )}

      {/* Step 0: Load Balancer (LB mode) */}
      {step === 0 && isLb && tokenReady && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="size-5" />
              Hetzner Load Balancer
            </CardTitle>
            <CardDescription>
              Select an existing Load Balancer or create a new one for your PostgreSQL cluster.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {hetznerLoadBalancers.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Fetching Load Balancers...
              </div>
            )}
            {hetznerLoadBalancers.isError && (
              <p className="text-sm text-destructive">
                Failed to fetch Load Balancers. Check your API token in Settings.
              </p>
            )}
            {hetznerLbList.length > 0 && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Existing Load Balancer</Label>
                <Select
                  value={selectedLbId}
                  onValueChange={(val: string | null) => {
                    setSelectedLbId(val ?? "");
                    setCreateLbName("");
                  }}
                >
                  <SelectTrigger>
                    {selectedLbId
                      ? hetznerLbList.find((lb: any) => lb.id === selectedLbId)?.name || selectedLbId
                      : "Select a Load Balancer"}
                  </SelectTrigger>
                  <SelectContent className="!w-auto min-w-[300px]" side="bottom">
                    {hetznerLbList.map((lb: any) => (
                      <SelectItem key={lb.id} value={lb.id}>
                        {lb.name} ({lb.publicIp}) - {lb.location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedLbId && (
                  <div className="grid grid-cols-3 gap-4 text-sm bg-muted/50 rounded-lg p-3">
                    <div>
                      <span className="text-muted-foreground">Public IP</span>
                      <p className="font-mono">{hetznerLbList.find((l: any) => l.id === selectedLbId)?.publicIp || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Private IP</span>
                      <p className="font-mono">{hetznerLbList.find((l: any) => l.id === selectedLbId)?.privateIp || "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Location</span>
                      <p>{hetznerLbList.find((l: any) => l.id === selectedLbId)?.location || "N/A"}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {hetznerLbList.length === 0 && !hetznerLoadBalancers.isLoading && !hetznerLoadBalancers.isError && (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  No Load Balancers found. Create one:
                </p>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Load Balancer Name</Label>
                  <Input
                    placeholder="my-pg-lb"
                    value={createLbName}
                    onChange={(e) => {
                      setCreateLbName(e.target.value);
                      setSelectedLbId("");
                    }}
                  />
                </div>
                {createLbName && (
                  <p className="text-xs text-muted-foreground">
                    A new LB will be created with TCP service on port 5432 and Patroni health checks during deployment.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 1: PostgreSQL Nodes */}
      {step === 1 && tokenReady && (
        <div className="grid gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Server Security</CardTitle>
              <CardDescription>A dedicated admin user will be created on every server. Root login will be disabled.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-1.5 max-w-xs">
                <Label className="text-xs">Admin Username</Label>
                <Input
                  placeholder="haforge"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value.replace(/[^a-z_][a-z0-9_-]*/g, ""))}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                This user will be created with sudo access. Root SSH login will be disabled for security.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Database Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Username</Label>
                  <Input
                    placeholder="postgres"
                    value={superuserUsername}
                    onChange={(e) => setSuperuserUsername(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                A secure password will be auto-generated. Defaults to "postgres" — change only if needed.
              </p>
            </CardContent>
          </Card>
          {hetznerServers.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              Fetching servers from Hetzner...
            </div>
          )}
          {hetznerServers.isError && (
            <p className="text-sm text-destructive py-4">Failed to fetch servers. Check your API token in Settings.</p>
          )}
          {hetznerServerList.length > 0 ? (
            <div className="grid grid-cols-3 gap-4">
              {PG_ROLES.map((r) => (
              <Card key={r.role}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{r.label}</CardTitle>
                    <Badge variant="secondary">{r.sublabel}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Hetzner Server</Label>
                    <Select
                      value={pgServers[r.role].hetznerServerId}
                      onValueChange={(val: string | null) => {
                        const srv = hetznerServerList.find((s: any) => s.id === val);
                        if (srv) {
                          setPgServers((prev) => ({
                            ...prev,
                            [r.role]: {
                              ...prev[r.role],
                              hetznerServerId: srv.id,
                              ipAddress: srv.publicIp,
                              privateIpAddress: srv.privateIps?.[0]?.ip || "",
                              sshKeyId: srv.sshKeyId || "",
                            },
                          }));
                        }
                      }}
                    >
                      <SelectTrigger>
                        {pgServers[r.role].hetznerServerId
                          ? hetznerServerList.find((s: any) => s.id === pgServers[r.role].hetznerServerId)?.name || pgServers[r.role].hetznerServerId
                          : "Select a server"}
                      </SelectTrigger>
                      <SelectContent className="!w-auto min-w-[300px]" side="bottom">
                        {hetznerServerList
                          .filter((srv: any) => {
                            const currentId = pgServers[r.role].hetznerServerId;
                            if (usedIds.has(srv.id) && srv.id !== currentId) return false;
                            const otherPgIds = PG_ROLES.filter((pr) => pr.role !== r.role)
                              .map((pr) => pgServers[pr.role].hetznerServerId)
                              .filter(Boolean);
                            const haIds = HA_ROLES.map((hr) => haServers[hr.role].hetznerServerId).filter(Boolean);
                            const clusterIds = [...otherPgIds, ...haIds];
                            return srv.id === currentId || !clusterIds.includes(srv.id);
                          })
                          .map((srv: any) => (
                            <SelectItem key={srv.id} value={srv.id}>
                              {srv.name} ({srv.publicIp})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {pgServers[r.role].hetznerServerId && (
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">Public IP</span>
                        <p className="font-mono">{pgServers[r.role].ipAddress}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Private IP</span>
                        <p className="font-mono">{pgServers[r.role].privateIpAddress || "N/A"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Server ID</span>
                        <p className="font-mono">{pgServers[r.role].hetznerServerId}</p>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">SSH User</Label>
                      <Input
                        value={pgServers[r.role].sshUser}
                        onChange={(e) =>
                          setPgServers((prev) => ({
                            ...prev,
                            [r.role]: { ...prev[r.role], sshUser: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">SSH Port</Label>
                      <Input
                        value={pgServers[r.role].sshPort}
                        onChange={(e) =>
                          setPgServers((prev) => ({
                            ...prev,
                            [r.role]: { ...prev[r.role], sshPort: Number(e.target.value) },
                          }))
                        }
                      />
                    </div>
                  </div>
                  {pgServers[r.role].sshKeyId && (
                    <div className="text-xs text-green-600 flex items-center gap-1">
                      <KeyRound className="size-3" />
                      SSH key: {hetznerServerList.find((s: any) => s.id === pgServers[r.role].hetznerServerId)?.sshKeyName || "Assigned"}
                    </div>
                  )}
                  {!pgServers[r.role].sshKeyId && pgServers[r.role].hetznerServerId && (
                    <div className="text-xs text-destructive flex items-center gap-1">
                      <KeyRound className="size-3" />
                      No SSH key assigned. <a href={`/dashboard/servers/hetzner-${pgServers[r.role].hetznerServerId}`} className="underline" target="_blank">Assign one</a>.
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTestingRole(r.role);
                      testConnection.mutate(
                        {
                          ipAddress: pgServers[r.role].ipAddress,
                          sshPort: pgServers[r.role].sshPort,
                          sshUser: pgServers[r.role].sshUser,
                          sshKeyId: pgServers[r.role].sshKeyId,
                        },
                        { onSettled: () => setTestingRole(null) },
                      );
                    }}
                    disabled={!pgServers[r.role].ipAddress || !pgServers[r.role].sshKeyId || testConnection.isPending}
                  >
                    {testConnection.isPending && testingRole === r.role ? (
                      <>
                        <Loader2 className="size-3 mr-1 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      "Test Connection"
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No servers found. Create servers in the Servers page first.</p>
          )}
        </div>
      )}

      {/* Step 2: Review & Deploy */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="size-5" />
              Review Configuration
            </CardTitle>
            <CardDescription>
              {isLb
                ? "Verify your cluster setup before deploying. This will execute commands on 3 PostgreSQL servers and configure the Hetzner Load Balancer."
                : "Verify your cluster setup before deploying. This will execute commands on all 6 servers."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {!isLb && (
              <>
                <div>
                  <h3 className="text-sm font-medium mb-3">Floating IP</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 rounded-lg p-3">
                    <div>
                      <span className="text-muted-foreground">IP Address</span>
                      <p className="font-mono">{floatingIp}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">IP ID</span>
                      <p className="font-mono">{floatingIpId}</p>
                    </div>
                  </div>
                </div>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium mb-3">HAProxy Nodes</h3>
                  <div className="grid gap-2">
                    {HA_ROLES.map((r) => (
                      <div key={r.role} className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-2.5">
                        <Network className="size-4 text-muted-foreground" />
                        <Badge variant="secondary" className="text-xs">{r.sublabel}</Badge>
                        <span className="font-mono">{haServers[r.role].ipAddress}</span>
                        <span className="text-muted-foreground text-xs">
                          (Private: {haServers[r.role].privateIpAddress || "N/A"})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
              </>
            )}
            {isLb && (
              <>
                <div>
                  <h3 className="text-sm font-medium mb-3">Load Balancer</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 rounded-lg p-3">
                    <div>
                      <span className="text-muted-foreground">Name</span>
                      <p className="font-mono">
                        {hetznerLbList.find((lb: any) => lb.id === selectedLbId)?.name || createLbName || "New LB"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Public IP</span>
                      <p className="font-mono">
                        {hetznerLbList.find((lb: any) => lb.id === selectedLbId)?.publicIp || "Pending creation"}
                      </p>
                    </div>
                  </div>
                </div>
                <Separator />
              </>
            )}
            <div>
              <h3 className="text-sm font-medium mb-3">PostgreSQL Nodes</h3>
              <div className="grid gap-2">
                {PG_ROLES.map((r) => (
                  <div key={r.role} className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-2.5">
                    <Database className="size-4 text-muted-foreground" />
                    <Badge variant="secondary" className="text-xs">{r.sublabel}</Badge>
                    <span className="font-mono">{pgServers[r.role].ipAddress}</span>
                    <span className="text-muted-foreground text-xs">
                      (Private: {pgServers[r.role].privateIpAddress || "N/A"})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button
          variant="outline"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          <ArrowLeft className="size-4 mr-1" />
          Back
        </Button>
        {step < 2 ? (
          <Button
            onClick={async () => {
              await saveDraft(step);
              setStep((s) => s + 1);
            }}
            disabled={!canProceed() || draftSaving}
          >
            Next
            <ArrowRight className="size-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={handleSaveAndDeploy}
            disabled={startDeployment.isPending}
            size="lg"
          >
            {startDeployment.isPending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="size-4 mr-2" />
                Deploy Cluster
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
