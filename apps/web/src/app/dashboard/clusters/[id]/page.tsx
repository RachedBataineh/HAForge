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
import { Separator } from "@HAForge/ui/components/separator";
import { Textarea } from "@HAForge/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

const PG_ROLES = [
  { role: "postgresql_1" as const, label: "PostgreSQL Node 1 (Primary)", num: 1 },
  { role: "postgresql_2" as const, label: "PostgreSQL Node 2 (Replica)", num: 2 },
  { role: "postgresql_3" as const, label: "PostgreSQL Node 3 (Replica)", num: 3 },
];

const HA_ROLES = [
  { role: "haproxy_1" as const, label: "HAProxy Node 1 (Master)", num: 1 },
  { role: "haproxy_2" as const, label: "HAProxy Node 2 (Backup)", num: 2 },
  { role: "haproxy_3" as const, label: "HAProxy Node 3 (Backup)", num: 3 },
];

interface ServerForm {
  ipAddress: string;
  sshPrivateKey: string;
  sshUser: string;
  sshPort: number;
  hetznerServerId: string;
}

export default function ClusterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [clusterId, setClusterId] = useState("");
  params.then((p) => setClusterId(p.id));

  const cluster = useQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));

  const [step, setStep] = useState(0);
  const [hetznerToken, setHetznerToken] = useState("");
  const [floatingIp, setFloatingIp] = useState("");
  const [floatingIpId, setFloatingIpId] = useState("");
  const [pgServers, setPgServers] = useState<Record<string, ServerForm>>({
    postgresql_1: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "" },
    postgresql_2: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "" },
    postgresql_3: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "" },
  });
  const [haServers, setHaServers] = useState<Record<string, ServerForm>>({
    haproxy_1: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "" },
    haproxy_2: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "" },
    haproxy_3: { ipAddress: "", sshPrivateKey: "", sshUser: "root", sshPort: 22, hetznerServerId: "" },
  });

  const updateCluster = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/trpc/cluster.update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: data }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.cluster.getById.queryFilter());
      toast.success("Cluster updated");
    },
  });

  const addServer = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/trpc/server.add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: data }),
      });
      return res.json();
    },
  });

  const testConnection = useMutation({
    mutationFn: async (data: { ipAddress: string; sshPort: number; sshUser: string; sshPrivateKey: string }) => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/trpc/server.testConnection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: data }),
      });
      const json = await res.json();
      return json.result.data.json;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success("SSH connection successful");
      } else {
        toast.error(`Connection failed: ${data.message}`);
      }
    },
  });

  const startDeployment = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/trpc/execution.start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: { clusterId } }),
      });
      const json = await res.json();
      return json.result.data.json;
    },
    onSuccess: (data) => {
      router.push(`/dashboard/clusters/${clusterId}/deploy?executionId=${data.executionId}`);
    },
  });

  const handleSaveAndDeploy = async () => {
    // Save cluster config
    await updateCluster.mutateAsync({
      id: clusterId,
      hetznerApiToken: hetznerToken,
      floatingIp,
      floatingIpId,
    });

    // Remove existing servers and add new ones
    const existingServers = cluster.data?.servers || [];
    for (const s of existingServers) {
      await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/trpc/server.remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ json: { id: s.id } }),
      });
    }

    // Add all 6 servers
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
      });
    }

    startDeployment.mutate();
  };

  const steps = [
    { title: "Hetzner Config", description: "Floating IP & API token" },
    { title: "PostgreSQL Nodes", description: "3 database servers" },
    { title: "HAProxy Nodes", description: "3 proxy servers" },
    { title: "Review & Deploy", description: "Confirm and start" },
  ];

  if (!clusterId) return <div className="p-8">Loading...</div>;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{cluster.data?.name || "Cluster Setup"}</h1>
        <p className="text-muted-foreground mt-1">Configure your 6-server HA cluster</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              onClick={() => setStep(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-muted text-muted-foreground"
                    : "text-muted-foreground"
              }`}
            >
              <span className="font-medium">{i + 1}</span>
              <span className="hidden sm:inline">{s.title}</span>
            </button>
            {i < steps.length - 1 && <div className="w-4 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 0: Hetzner Config */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hetzner Cloud Configuration</CardTitle>
            <CardDescription>
              Provide your Hetzner Cloud API token and Floating IP details for automatic failover.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label>Hetzner API Token</Label>
              <Input
                type="password"
                placeholder="hcloud_xxxxx..."
                value={hetznerToken}
                onChange={(e) => setHetznerToken(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Floating IP Address</Label>
              <Input
                placeholder="1.2.3.4"
                value={floatingIp}
                onChange={(e) => setFloatingIp(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Floating IP ID</Label>
              <Input
                placeholder="12345"
                value={floatingIpId}
                onChange={(e) => setFloatingIpId(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!hetznerToken || !floatingIp || !floatingIpId}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: PostgreSQL Nodes */}
      {step === 1 && (
        <div className="grid gap-4">
          {PG_ROLES.map((r) => (
            <Card key={r.role}>
              <CardHeader>
                <CardTitle className="text-lg">{r.label}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>IP Address</Label>
                    <Input
                      placeholder="10.0.0.1"
                      value={pgServers[r.role].ipAddress}
                      onChange={(e) =>
                        setPgServers((prev) => ({
                          ...prev,
                          [r.role]: { ...prev[r.role], ipAddress: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>SSH User</Label>
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
                </div>
                <div className="grid gap-2">
                  <Label>SSH Private Key</Label>
                  <Textarea
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={4}
                    value={pgServers[r.role].sshPrivateKey}
                    onChange={(e) =>
                      setPgServers((prev) => ({
                        ...prev,
                        [r.role]: { ...prev[r.role], sshPrivateKey: e.target.value },
                      }))
                    }
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    testConnection.mutate({
                      ipAddress: pgServers[r.role].ipAddress,
                      sshPort: pgServers[r.role].sshPort,
                      sshUser: pgServers[r.role].sshUser,
                      sshPrivateKey: pgServers[r.role].sshPrivateKey,
                    })
                  }
                  disabled={!pgServers[r.role].ipAddress || !pgServers[r.role].sshPrivateKey}
                >
                  {testConnection.isPending ? "Testing..." : "Test Connection"}
                </Button>
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
            <Button
              onClick={() => setStep(2)}
              disabled={PG_ROLES.some((r) => !pgServers[r.role].ipAddress || !pgServers[r.role].sshPrivateKey)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: HAProxy Nodes */}
      {step === 2 && (
        <div className="grid gap-4">
          {HA_ROLES.map((r) => (
            <Card key={r.role}>
              <CardHeader>
                <CardTitle className="text-lg">{r.label}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>IP Address</Label>
                    <Input
                      placeholder="10.0.1.1"
                      value={haServers[r.role].ipAddress}
                      onChange={(e) =>
                        setHaServers((prev) => ({
                          ...prev,
                          [r.role]: { ...prev[r.role], ipAddress: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Hetzner Server ID</Label>
                    <Input
                      placeholder="98765"
                      value={haServers[r.role].hetznerServerId}
                      onChange={(e) =>
                        setHaServers((prev) => ({
                          ...prev,
                          [r.role]: { ...prev[r.role], hetznerServerId: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>SSH Private Key</Label>
                  <Textarea
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={4}
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
                  onClick={() =>
                    testConnection.mutate({
                      ipAddress: haServers[r.role].ipAddress,
                      sshPort: haServers[r.role].sshPort,
                      sshUser: haServers[r.role].sshUser,
                      sshPrivateKey: haServers[r.role].sshPrivateKey,
                    })
                  }
                  disabled={!haServers[r.role].ipAddress || !haServers[r.role].sshPrivateKey}
                >
                  {testConnection.isPending ? "Testing..." : "Test Connection"}
                </Button>
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button
              onClick={() => setStep(3)}
              disabled={HA_ROLES.some((r) => !haServers[r.role].ipAddress || !haServers[r.role].sshPrivateKey || !haServers[r.role].hetznerServerId)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Deploy */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Review Configuration</CardTitle>
            <CardDescription>
              Verify your cluster setup before deploying. This will execute commands on all 6 servers.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div>
              <h3 className="font-medium mb-2">Hetzner Config</h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>Floating IP: <code>{floatingIp}</code></div>
                <div>IP ID: <code>{floatingIpId}</code></div>
                <div>Token: <code>****</code></div>
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="font-medium mb-2">PostgreSQL Nodes</h3>
              <div className="grid gap-2">
                {PG_ROLES.map((r) => (
                  <div key={r.role} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{r.label}</Badge>
                    <code>{pgServers[r.role].ipAddress}</code>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="font-medium mb-2">HAProxy Nodes</h3>
              <div className="grid gap-2">
                {HA_ROLES.map((r) => (
                  <div key={r.role} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{r.label}</Badge>
                    <code>{haServers[r.role].ipAddress}</code>
                    <span className="text-muted-foreground">(Hetzner ID: {haServers[r.role].hetznerServerId})</span>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button
                onClick={handleSaveAndDeploy}
                disabled={startDeployment.isPending}
                size="lg"
              >
                {startDeployment.isPending ? "Deploying..." : "Deploy Cluster"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
