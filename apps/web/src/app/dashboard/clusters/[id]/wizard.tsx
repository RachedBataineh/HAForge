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
  SelectValue,
} from "@HAForge/ui/components/select";
import { Progress } from "@HAForge/ui/components/progress";
import { Separator } from "@HAForge/ui/components/separator";
import { Textarea } from "@HAForge/ui/components/textarea";
import {
  Cloud,
  Database,
  Globe,
  Rocket,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

const PG_ROLES = [
  { role: "postgresql_1" as const, label: "PostgreSQL Node 1", sublabel: "Primary", num: 1 },
  { role: "postgresql_2" as const, label: "PostgreSQL Node 2", sublabel: "Replica", num: 2 },
  { role: "postgresql_3" as const, label: "PostgreSQL Node 3", sublabel: "Replica", num: 3 },
];

const HA_ROLES = [
  { role: "haproxy_1" as const, label: "HAProxy Node 1", sublabel: "Master", num: 1 },
  { role: "haproxy_2" as const, label: "HAProxy Node 2", sublabel: "Backup", num: 2 },
  { role: "haproxy_3" as const, label: "HAProxy Node 3", sublabel: "Backup", num: 3 },
];

interface ServerForm {
  ipAddress: string;
  sshPrivateKey: string;
  sshUser: string;
  sshPort: number;
  hetznerServerId: string;
  privateIpAddress: string;
}

const stepIcons = [Cloud, Globe, Database, Rocket];
const stepTitles = ["Hetzner Config", "HAProxy Nodes", "PostgreSQL Nodes", "Review & Deploy"];

export default function ClusterSetupWizard({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const cluster = useQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));

  const [step, setStep] = useState(0);
  const [testingRole, setTestingRole] = useState<string | null>(null);
  const [hetznerToken, setHetznerToken] = useState("");
  const [floatingIp, setFloatingIp] = useState("");
  const [floatingIpId, setFloatingIpId] = useState("");

  const floatingIps = useQuery(
    trpc.cluster.hetznerFloatingIps.queryOptions(
      { apiToken: hetznerToken },
      { enabled: hetznerToken.length > 10 },
    ),
  );

  const floatingIpList = (floatingIps.data ?? []) as any[];

  const hetznerServers = useQuery(
    trpc.cluster.hetznerServers.queryOptions(
      { apiToken: hetznerToken },
      { enabled: hetznerToken.length > 10 },
    ),
  );

  const hetznerServerList = (hetznerServers.data ?? []) as any[];

  const [pgServers, setPgServers] = useState<Record<string, ServerForm>>({
    postgresql_1: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "" },
    postgresql_2: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "" },
    postgresql_3: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "" },
  });
  const [haServers, setHaServers] = useState<Record<string, ServerForm>>({
    haproxy_1: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "" },
    haproxy_2: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "" },
    haproxy_3: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "", privateIpAddress: "" },
  });

  const updateCluster = useMutation({
    mutationFn: async (data: any) => trpcClient.cluster.update.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.cluster.getById.queryFilter());
      toast.success("Cluster updated");
    },
  });

  const addServer = useMutation({
    mutationFn: async (data: any) => trpcClient.server.add.mutate(data),
  });

  const testConnection = useMutation({
    mutationFn: async (data: { ipAddress: string; sshPort: number; sshUser: string; sshPrivateKey: string }) =>
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

  const handleSaveAndDeploy = async () => {
    await updateCluster.mutateAsync({ id: clusterId, hetznerApiToken: hetznerToken, floatingIp, floatingIpId });

    const existingServers = cluster.data?.servers || [];
    for (const s of existingServers) {
      await trpcClient.server.remove.mutate({ id: s.id });
    }

    const allServers = [
      ...PG_ROLES.map((r) => ({ ...pgServers[r.role], role: r.role })),
      ...HA_ROLES.map((r) => ({ ...haServers[r.role], role: r.role })),
    ];

    for (const server of allServers) {
      await addServer.mutateAsync({
        clusterId,
        ipAddress: server.ipAddress,
        sshPrivateKey: server.sshPrivateKey,
        sshUser: server.sshUser,
        sshPort: server.sshPort,
        role: server.role,
        hetznerServerId: server.hetznerServerId || undefined,
        privateIpAddress: server.privateIpAddress || undefined,
      });
    }

    startDeployment.mutate();
  };

  const canProceed = () => {
    if (step === 0) return !!(hetznerToken && floatingIp && floatingIpId);
    if (step === 1) return HA_ROLES.every((r) => haServers[r.role].ipAddress && haServers[r.role].sshPrivateKey && haServers[r.role].hetznerServerId);
    if (step === 2) return PG_ROLES.every((r) => pgServers[r.role].ipAddress && pgServers[r.role].sshPrivateKey);
    return true;
  };

  const renderServerCard = (
    role: string,
    label: string,
    sublabel: string,
    form: ServerForm,
    onChange: (updated: ServerForm) => void,
    showHetznerId: boolean,
  ) => (
    <Card key={role}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{label}</CardTitle>
          <Badge variant="secondary">{sublabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Public IP Address</Label>
            <Input
              placeholder="1.2.3.4"
              value={form.ipAddress}
              onChange={(e) => onChange({ ...form, ipAddress: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Private IP Address</Label>
            <Input
              placeholder="10.0.0.2"
              value={form.privateIpAddress}
              onChange={(e) => onChange({ ...form, privateIpAddress: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">SSH User</Label>
            <Input
              value={form.sshUser}
              onChange={(e) => onChange({ ...form, sshUser: e.target.value })}
            />
          </div>
          {showHetznerId && (
            <div className="grid gap-1.5">
              <Label className="text-xs">Hetzner Server ID</Label>
              <Input
                placeholder="98765"
                value={form.hetznerServerId}
                onChange={(e) => onChange({ ...form, hetznerServerId: e.target.value })}
              />
            </div>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">SSH Private Key</Label>
          <Textarea
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            rows={3}
            value={form.sshPrivateKey}
            onChange={(e) => onChange({ ...form, sshPrivateKey: e.target.value })}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTestingRole(role);
            testConnection.mutate(
              {
                ipAddress: form.ipAddress,
                sshPort: form.sshPort,
                sshUser: form.sshUser,
                sshPrivateKey: form.sshPrivateKey,
              },
              { onSettled: () => setTestingRole(null) },
            );
          }}
          disabled={!form.ipAddress || !form.sshPrivateKey || testConnection.isPending}
        >
          {testConnection.isPending && testingRole === role ? (
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
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {cluster.data?.name || "Cluster Setup"}
        </h1>
        <p className="text-muted-foreground">Configure your 6-server HA cluster</p>
      </div>

      {/* Progress bar */}
      <div className="space-y-3">
        <Progress value={((step + 1) / stepTitles.length) * 100} className="h-1.5" />
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

      {/* Step 0: Hetzner Config */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="size-5" />
              Hetzner Cloud Configuration
            </CardTitle>
            <CardDescription>
              Enter your Hetzner Cloud API token. Floating IPs will be fetched automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">Hetzner API Token</Label>
              <Input
                type="password"
                placeholder="hcloud_xxxxx..."
                value={hetznerToken}
                onChange={(e) => {
                  setHetznerToken(e.target.value);
                  setFloatingIp("");
                  setFloatingIpId("");
                }}
              />
            </div>
            {hetznerToken.length > 10 && floatingIps.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Fetching floating IPs...
              </div>
            )}
            {hetznerToken.length > 10 && floatingIps.isError && (
              <p className="text-sm text-destructive">
                Failed to fetch floating IPs. Check your API token.
              </p>
            )}
            {floatingIpList.length > 0 && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Floating IP</Label>
                <Select
                  value={floatingIpId}
                  onValueChange={(val) => {
                    const selected = floatingIpList.find((ip: any) => ip.id === val);
                    if (selected) {
                      setFloatingIpId(selected.id);
                      setFloatingIp(selected.ip);
                    }
                  }}
                >
                  <SelectTrigger>
                    {floatingIpId
                      ? floatingIpList.find((ip: any) => ip.id === floatingIpId)?.ip || floatingIpId
                      : "Select a Floating IP"}
                  </SelectTrigger>
                  <SelectContent className="!w-auto min-w-[300px]" side="bottom">
                    {floatingIpList.map((ip: any) => (
                      <SelectItem key={ip.id} value={ip.id}>
                        {ip.ip} {ip.name ? `(${ip.name})` : ""} - {ip.homeLocation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {floatingIpList.length === 0 && !floatingIps.isLoading && !floatingIps.isError && hetznerToken.length > 10 && (
              <p className="text-sm text-muted-foreground">
                No floating IPs found in your Hetzner account. Create one first.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 1: HAProxy Nodes */}
      {step === 1 && (
        <div className="grid gap-4">
          {hetznerServers.isLoading && hetznerToken.length > 10 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              Fetching servers from Hetzner...
            </div>
          )}
          {hetznerServers.isError && (
            <p className="text-sm text-destructive py-4">Failed to fetch servers. Check your API token.</p>
          )}
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
                <div className="grid gap-1.5">
                  <Label className="text-xs">SSH Private Key</Label>
                  <Textarea
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={3}
                    value={haServers[r.role].sshPrivateKey}
                    onChange={(e) =>
                      setHaServers((prev) => ({
                        ...prev,
                        [r.role]: { ...prev[r.role], sshPrivateKey: e.target.value },
                      }))
                    }
                  />
                </div>
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
                        sshPrivateKey: haServers[r.role].sshPrivateKey,
                      },
                      { onSettled: () => setTestingRole(null) },
                    );
                  }}
                  disabled={!haServers[r.role].ipAddress || !haServers[r.role].sshPrivateKey || testConnection.isPending}
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
      )}

      {/* Step 2: PostgreSQL Nodes */}
      {step === 2 && (
        <div className="grid gap-4">
          {PG_ROLES.map((r) =>
            renderServerCard(
              r.role,
              r.label,
              r.sublabel,
              pgServers[r.role],
              (updated) => setPgServers((prev) => ({ ...prev, [r.role]: updated })),
              false,
            )
          )}
        </div>
      )}

      {/* Step 3: Review & Deploy */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="size-5" />
              Review Configuration
            </CardTitle>
            <CardDescription>
              Verify your cluster setup before deploying. This will execute commands on all 6 servers.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div>
              <h3 className="text-sm font-medium mb-3">Hetzner Config</h3>
              <div className="grid grid-cols-3 gap-4 text-sm bg-muted/50 rounded-lg p-3">
                <div>
                  <span className="text-muted-foreground">Floating IP</span>
                  <p className="font-mono">{floatingIp}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">IP ID</span>
                  <p className="font-mono">{floatingIpId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">API Token</span>
                  <p className="font-mono">****</p>
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="text-sm font-medium mb-3">HAProxy Nodes</h3>
              <div className="grid gap-2">
                {HA_ROLES.map((r) => (
                  <div key={r.role} className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-2.5">
                    <Globe className="size-4 text-muted-foreground" />
                    <Badge variant="secondary" className="text-xs">{r.sublabel}</Badge>
                    <span className="font-mono">{haServers[r.role].ipAddress}</span>
                    <span className="text-muted-foreground text-xs">
                      (Private: {haServers[r.role].privateIpAddress || "N/A"}, Hetzner ID: {haServers[r.role].hetznerServerId})
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
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
        {step < 3 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()}>
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
