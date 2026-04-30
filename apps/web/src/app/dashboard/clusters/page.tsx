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
import { Skeleton } from "@HAForge/ui/components/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@HAForge/ui/components/select";
import { Separator } from "@HAForge/ui/components/separator";
import {
  Server,
  Plus,
  Database,
  Activity,
  CheckCircle2,
  AlertCircle,
  Globe,
  Trash2,
  Network,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Zap,
  Hand,
  ShoppingCart,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";
import { DeleteClusterDialog } from "./delete-cluster-dialog";

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

function ClusterCard({ cluster, onDeleted }: { cluster: any; onDeleted: () => void }) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const Icon = statusIcon[cluster.status] || Server;
  const clusterServers = cluster.servers ?? [];
  const pg = clusterServers.filter((s: any) => s.role?.startsWith("postgresql")).length;
  const ha = clusterServers.filter((s: any) => s.role?.startsWith("haproxy")).length;

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => router.push(`/dashboard/clusters/${cluster.id}`)}
    >
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">{cluster.name}</CardTitle>
            <CardDescription className="flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1">
                <Database className="size-3" />
                {pg} PostgreSQL
              </span>
              {cluster.clusterType === "hetzner_lb" ? (
                <span className="flex items-center gap-1">
                  <Network className="size-3" />
                  {cluster.loadBalancerId ? "1" : "0"} Load Balancer
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Globe className="size-3" />
                  {ha} HAProxy
                </span>
              )}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusColor[cluster.status] || "outline"}>
            {cluster.status}
          </Badge>
          {cluster.status === "draft" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
            </Button>
          )}
        </div>
      </CardHeader>

      <div onClick={(e) => e.stopPropagation()}>
        <DeleteClusterDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          clusterName={cluster.name}
          onConfirm={async () => {
            try {
              await trpcClient.cluster.delete.mutate({ id: cluster.id });
              onDeleted();
            } catch (err: any) {
              toast.error(err.message || "Failed to delete cluster");
            }
          }}
        />
      </div>
    </Card>
  );
}

// Provisioning steps with labels
const PROVISION_STEPS = [
  "Creating cluster...",
  "Creating network...",
  "Creating servers (1/6)...",
  "Creating servers (2/6)...",
  "Creating servers (3/6)...",
  "Creating servers (4/6)...",
  "Creating servers (5/6)...",
  "Creating servers (6/6)...",
  "Waiting for servers to start...",
  "Creating floating IP...",
  "Assigning floating IP...",
  "Saving configuration...",
  "Calculating costs...",
] as const;

export default function ClusterListPage() {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Manual mode state
  const [newClusterName, setNewClusterName] = useState("");
  const [newClusterType, setNewClusterType] = useState<"haproxy" | "hetzner_lb">("haproxy");

  // Automatic mode state
  const [provisioningMode, setProvisioningMode] = useState<"manual" | "automatic">("manual");
  const [autoStep, setAutoStep] = useState(0); // 0: basics, 1: server types, 2: invoice, 3: provisioning
  const [autoLocation, setAutoLocation] = useState("");
  const [autoNetworkZone, setAutoNetworkZone] = useState("");
  const [autoSshKeyId, setAutoSshKeyId] = useState("");
  const [autoHaServerType, setAutoHaServerType] = useState("");
  const [autoPgServerType, setAutoPgServerType] = useState("");
  const [autoAdminUsername, setAutoAdminUsername] = useState("haforge");
  const [autoDbUsername, setAutoDbUsername] = useState("postgres");
  const [provisioningProgress, setProvisioningProgress] = useState(0);

  const [activeTab, setActiveTab] = useState<"active" | "draft">("active");

  const clusters = useQuery(trpc.cluster.list.queryOptions());

  const activeClusters = (clusters.data ?? []).filter((c: any) => c.status !== "draft");
  const draftClusters = (clusters.data ?? []).filter((c: any) => c.status === "draft");

  // Hetzner data for automatic mode
  const serverTypes = useQuery(trpc.cluster.hetznerServerTypes.queryOptions());
  const locations = useQuery(trpc.cluster.hetznerLocations.queryOptions());
  const networkZones = useQuery(trpc.cluster.hetznerNetworkZones.queryOptions());
  const sshKeys = useQuery(trpc.cluster.allHetznerSshKeys.queryOptions());
  const pricing = useQuery(trpc.cluster.hetznerPricing.queryOptions());

  const serverTypesData = (serverTypes.data ?? []) as any[];
  const locationsData = (locations.data ?? []) as any[];
  const networkZonesData = (networkZones.data ?? []) as any[];
  const sshKeysData = (sshKeys.data ?? []) as any[];

  // Manual cluster creation
  const createCluster = useMutation({
    mutationFn: async ({ name, type }: { name: string; type: "haproxy" | "hetzner_lb" }) => {
      return await trpcClient.cluster.create.mutate({ name, clusterType: type });
    },
    onSuccess: (data) => {
      clusters.refetch();
      closeDialog();
      router.push(`/dashboard/clusters/${data.id}`);
    },
  });

  // Automatic cluster provisioning
  const provisionCluster = useMutation({
    mutationFn: async () => {
      return await trpcClient.cluster.provisionAutomatic.mutate({
        name: newClusterName,
        clusterType: newClusterType,
        location: autoLocation,
        networkZone: autoNetworkZone,
        sshKeyId: autoSshKeyId,
        haproxyServerType: autoHaServerType,
        postgresqlServerType: autoPgServerType,
        adminUsername: autoAdminUsername,
        superuserUsername: autoDbUsername,
      });
    },
    onSuccess: (data) => {
      setProvisioningProgress(PROVISION_STEPS.length);
      clusters.refetch();
      setTimeout(() => {
        closeDialog();
        router.push(`/dashboard/clusters/${data.clusterId}`);
      }, 1500);
    },
    onError: (err: any) => {
      toast.error(err.message || "Provisioning failed");
      setAutoStep(2);
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setNewClusterName("");
    setNewClusterType("haproxy");
    setProvisioningMode("manual");
    setAutoStep(0);
    setAutoLocation("");
    setAutoNetworkZone("");
    setAutoSshKeyId("");
    setAutoHaServerType("");
    setAutoPgServerType("");
    setProvisioningProgress(0);
  };

  // Calculate invoice
  const getHaPrice = () => {
    const t = serverTypesData.find((t: any) => t.name === autoHaServerType);
    return parseFloat(t?.price || "0");
  };
  const getPgPrice = () => {
    const t = serverTypesData.find((t: any) => t.name === autoPgServerType);
    return parseFloat(t?.price || "0");
  };
  const getFipPrice = () => parseFloat(pricing.data?.floatingIpMonthly || "0");
  const getTotalMonthly = () => (getHaPrice() * 3 + getPgPrice() * 3 + getFipPrice()).toFixed(2);

  const canProceedAutoBasics = () =>
    !!newClusterName.trim() && !!autoLocation && !!autoNetworkZone && !!autoSshKeyId;
  const canProceedAutoServerTypes = () => !!autoHaServerType && !!autoPgServerType;

  // Simulate progress during provisioning
  const handleProvision = () => {
    setAutoStep(3);
    setProvisioningProgress(0);

    // Simulate incremental progress
    const steps = PROVISION_STEPS.length;
    let current = 0;
    const interval = setInterval(() => {
      current += 1;
      if (current >= steps - 2) {
        clearInterval(interval);
      }
      setProvisioningProgress(current);
    }, 3000);

    provisionCluster.mutate(undefined, {
      onSettled: () => clearInterval(interval),
    });
  };

  const renderAutoStepBasics = () => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>Cluster Name</Label>
        <Input
          placeholder="my-ha-cluster"
          value={newClusterName}
          onChange={(e) => setNewClusterName(e.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label>Cluster Type</Label>
        <div className="grid grid-cols-2 gap-3">
          <Card
            className={`cursor-pointer transition-colors ${newClusterType === "haproxy" ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
            onClick={() => setNewClusterType("haproxy")}
          >
            <CardContent className="py-3 text-center">
              <p className="font-medium text-sm">HAProxy</p>
              <p className="text-xs text-muted-foreground mt-1">3 PG + 3 HAProxy</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-colors ${newClusterType === "hetzner_lb" ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
            onClick={() => setNewClusterType("hetzner_lb")}
          >
            <CardContent className="py-3 text-center">
              <p className="font-medium text-sm">Hetzner LB</p>
              <p className="text-xs text-muted-foreground mt-1">3 PG + Load Balancer</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label>Location</Label>
          <Select value={autoLocation} onValueChange={(v) => setAutoLocation(v ?? "")}>
            <SelectTrigger>
              {autoLocation
                ? (() => { const l = locationsData.find((l: any) => l.name === autoLocation); return l ? `${l.city}, ${l.country} (${l.name})` : autoLocation; })()
                : "Select location"}
            </SelectTrigger>
            <SelectContent className="max-h-64" side="bottom">
              {locationsData.map((l: any) => (
                <SelectItem key={l.name} value={l.name}>
                  {l.city}, {l.country} ({l.name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Data center region where all servers will be created.</p>
        </div>

        <div className="grid gap-2">
          <Label>Network Zone</Label>
          <Select value={autoNetworkZone} onValueChange={(v) => setAutoNetworkZone(v ?? "")}>
            <SelectTrigger>
              {autoNetworkZone
                ? (() => { const z = networkZonesData.find((z: any) => z.name === autoNetworkZone); return z ? `${z.name} (${z.locations.join(", ")})` : autoNetworkZone; })()
                : "Select network zone"}
            </SelectTrigger>
            <SelectContent className="!w-auto min-w-[400px]" side="bottom">
              {networkZonesData.map((z: any) => (
                <SelectItem key={z.name} value={z.name}>
                  <span className="grid grid-cols-[auto_1fr] gap-x-4 w-full">
                    <span className="font-medium">{z.name}</span>
                    <span className="text-muted-foreground text-xs">{z.locations.join(", ")}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">All servers must be in the same network zone as the selected location.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label>Admin Username</Label>
          <Input
            placeholder="haforge"
            value={autoAdminUsername}
            onChange={(e) => setAutoAdminUsername(e.target.value.replace(/[^a-z_][a-z0-9_-]*/g, ""))}
          />
          <p className="text-xs text-muted-foreground">Created with sudo access on all servers. Root login will be disabled.</p>
        </div>
        <div className="grid gap-2">
          <Label>Database Username</Label>
          <Input
            placeholder="postgres"
            value={autoDbUsername}
            onChange={(e) => setAutoDbUsername(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">PostgreSQL superuser. A secure password will be auto-generated.</p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>SSH Key</Label>
        <Select value={autoSshKeyId} onValueChange={(v) => setAutoSshKeyId(v ?? "")}>
          <SelectTrigger>
            {autoSshKeyId
              ? sshKeysData.find((k: any) => k.id === autoSshKeyId)?.name || autoSshKeyId
              : "Select SSH key"}
          </SelectTrigger>
          <SelectContent side="bottom">
            {sshKeysData.filter((k: any) => k.privateKey).map((k: any) => (
              <SelectItem key={k.id} value={k.id}>
                {k.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sshKeysData.length === 0 && !sshKeys.isLoading && (
          <p className="text-xs text-muted-foreground">
            No SSH keys found. Add one with a private key in <a href="/dashboard/ssh-keys" className="underline">SSH Keys</a> first.
          </p>
        )}
      </div>
    </div>
  );

  const renderAutoStepServerTypes = () => (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label className="text-sm font-medium">HAProxy Servers (3x)</Label>
        <p className="text-xs text-muted-foreground">All 3 HAProxy nodes will use this server type.</p>
        <Select value={autoHaServerType} onValueChange={(v) => setAutoHaServerType(v ?? "")}>
          <SelectTrigger>
            {autoHaServerType
              ? (() => {
                  const t = serverTypesData.find((t: any) => t.name === autoHaServerType);
                  return t ? `${t.description} (${t.cores} vCPU, ${t.memory}GB RAM)` : autoHaServerType;
                })()
              : "Select HAProxy server type"}
          </SelectTrigger>
          <SelectContent className="!w-auto min-w-[480px] max-h-64" side="bottom">
            {serverTypesData.map((t: any) => (
              <SelectItem key={t.name} value={t.name} className="py-2">
                <span className="grid grid-cols-[1fr_auto] gap-x-4 w-full">
                  <span className="truncate">{t.description}</span>
                  <span className="text-muted-foreground whitespace-nowrap font-mono text-xs">
                    {t.cores} vCPU · {t.memory}GB · {t.disk}GB · €{t.price}/mo
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {autoHaServerType && (
          <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
            {(() => { const t = serverTypesData.find((t: any) => t.name === autoHaServerType); return t ? `${t.cores} vCPU, ${t.memory}GB RAM, ${t.disk}GB disk` : ""; })()}
            <span className="float-right font-mono">€{getHaPrice().toFixed(2)}/mo each</span>
          </div>
        )}
      </div>

      <Separator />

      <div className="grid gap-2">
        <Label className="text-sm font-medium">PostgreSQL Servers (3x)</Label>
        <p className="text-xs text-muted-foreground">All 3 PostgreSQL nodes will use this server type.</p>
        <Select value={autoPgServerType} onValueChange={(v) => setAutoPgServerType(v ?? "")}>
          <SelectTrigger>
            {autoPgServerType
              ? (() => {
                  const t = serverTypesData.find((t: any) => t.name === autoPgServerType);
                  return t ? `${t.description} (${t.cores} vCPU, ${t.memory}GB RAM)` : autoPgServerType;
                })()
              : "Select PostgreSQL server type"}
          </SelectTrigger>
          <SelectContent className="!w-auto min-w-[480px] max-h-64" side="bottom">
            {serverTypesData.map((t: any) => (
              <SelectItem key={t.name} value={t.name} className="py-2">
                <span className="grid grid-cols-[1fr_auto] gap-x-4 w-full">
                  <span className="truncate">{t.description}</span>
                  <span className="text-muted-foreground whitespace-nowrap font-mono text-xs">
                    {t.cores} vCPU · {t.memory}GB · {t.disk}GB · €{t.price}/mo
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {autoPgServerType && (
          <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
            {(() => { const t = serverTypesData.find((t: any) => t.name === autoPgServerType); return t ? `${t.cores} vCPU, ${t.memory}GB RAM, ${t.disk}GB disk` : ""; })()}
            <span className="float-right font-mono">€{getPgPrice().toFixed(2)}/mo each</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderAutoStepInvoice = () => {
    const haPrice = getHaPrice().toFixed(2);
    const pgPrice = getPgPrice().toFixed(2);
    const fipPrice = getFipPrice().toFixed(2);
    const haTotal = (getHaPrice() * 3).toFixed(2);
    const pgTotal = (getPgPrice() * 3).toFixed(2);
    const total = getTotalMonthly();

    const haType = serverTypesData.find((t: any) => t.name === autoHaServerType);
    const pgType = serverTypesData.find((t: any) => t.name === autoPgServerType);
    const location = locationsData.find((l: any) => l.name === autoLocation);

    return (
      <div className="grid gap-4">
        <div className="bg-muted/50 rounded-lg p-4 grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cluster</span>
            <span className="font-medium">{newClusterName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type</span>
            <span>{newClusterType === "haproxy" ? "HAProxy (6 servers)" : "Hetzner LB (3 servers + LB)"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Location</span>
            <span>{location ? `${location.city}, ${location.country}` : autoLocation}</span>
          </div>
        </div>

        <Separator />

        <div className="grid gap-2">
          <h4 className="text-sm font-medium">Monthly Invoice</h4>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Resource</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Unit Price</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Qty</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <Globe className="size-3.5 text-muted-foreground" />
                      <span>HAProxy ({haType?.description || autoHaServerType})</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono">€{haPrice}</td>
                  <td className="py-2 px-3 text-right">3</td>
                  <td className="py-2 px-3 text-right font-mono">€{haTotal}</td>
                </tr>
                <tr className="border-t">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <Database className="size-3.5 text-muted-foreground" />
                      <span>PostgreSQL ({pgType?.description || autoPgServerType})</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono">€{pgPrice}</td>
                  <td className="py-2 px-3 text-right">3</td>
                  <td className="py-2 px-3 text-right font-mono">€{pgTotal}</td>
                </tr>
                {newClusterType === "haproxy" && (
                  <tr className="border-t">
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <Network className="size-3.5 text-muted-foreground" />
                        <span>Floating IP</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">€{fipPrice}</td>
                    <td className="py-2 px-3 text-right">1</td>
                    <td className="py-2 px-3 text-right font-mono">€{fipPrice}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50">
                  <td colSpan={3} className="py-2.5 px-3 font-semibold">Total Monthly</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold">€{total}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Prices are gross and include VAT. Network creation is free.</p>
        </div>
      </div>
    );
  };

  const renderAutoStepProvisioning = () => {
    const done = provisionCluster.isSuccess;
    const failed = provisionCluster.isError;
    const currentStep = Math.min(provisioningProgress, PROVISION_STEPS.length - 1);

    return (
      <div className="grid gap-4 py-4">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="size-12 text-green-500" />
            <h3 className="text-lg font-semibold">Cluster Provisioned!</h3>
            <p className="text-sm text-muted-foreground">Redirecting to cluster setup...</p>
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <AlertCircle className="size-12 text-destructive" />
            <h3 className="text-lg font-semibold">Provisioning Failed</h3>
            <p className="text-sm text-muted-foreground">{provisionCluster.error?.message || "An error occurred"}</p>
            <Button variant="outline" onClick={() => setAutoStep(2)}>
              Go Back
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="size-10 text-primary animate-spin" />
            <h3 className="text-lg font-semibold">Provisioning Your Cluster...</h3>
            <p className="text-sm text-muted-foreground">
              {PROVISION_STEPS[currentStep]}
            </p>
            <div className="w-full max-w-sm">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${((currentStep + 1) / PROVISION_STEPS.length) * 100}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">This may take a few minutes...</p>
          </div>
        )}
      </div>
    );
  };

  const renderDialog = () => {
    if (provisioningMode === "manual") {
      return (
        <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) closeDialog(); else setDialogOpen(true); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Cluster</DialogTitle>
              <DialogDescription>
                Choose your cluster type and enter a name.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Cluster Type</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Card
                    className={`cursor-pointer transition-colors ${newClusterType === "haproxy" ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
                    onClick={() => setNewClusterType("haproxy")}
                  >
                    <CardContent className="py-3 text-center">
                      <p className="font-medium text-sm">HAProxy</p>
                      <p className="text-xs text-muted-foreground mt-1">3 PG + 3 HAProxy</p>
                    </CardContent>
                  </Card>
                  <Card
                    className={`cursor-pointer transition-colors ${newClusterType === "hetzner_lb" ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
                    onClick={() => setNewClusterType("hetzner_lb")}
                  >
                    <CardContent className="py-3 text-center">
                      <p className="font-medium text-sm">Hetzner LB</p>
                      <p className="text-xs text-muted-foreground mt-1">3 PG + Load Balancer</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
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
                onClick={() => createCluster.mutate({ name: newClusterName, type: newClusterType })}
                disabled={!newClusterName.trim() || createCluster.isPending}
              >
                {createCluster.isPending ? "Creating..." : "Create Cluster"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    // Automatic mode — wider dialog, multi-step
    return (
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) closeDialog(); else setDialogOpen(true); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-5" />
              Automatic Cluster Provisioning
            </DialogTitle>
            <DialogDescription>
              {autoStep === 0 && "Configure the basics — HAForge will purchase and set up everything for you."}
              {autoStep === 1 && "Choose server types for your HAProxy and PostgreSQL nodes."}
              {autoStep === 2 && "Review your monthly costs before provisioning."}
              {autoStep === 3 && "Your cluster is being provisioned on Hetzner."}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          {autoStep < 3 && (
            <div className="flex items-center gap-2 pb-2">
              {["Basics", "Server Types", "Invoice"].map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 text-xs ${
                    i === autoStep ? "text-primary font-medium" : i < autoStep ? "text-muted-foreground" : "text-muted-foreground/40"
                  }`}>
                    {i < autoStep ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <div className={`size-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                        i === autoStep ? "border-primary text-primary" : "border-muted-foreground/30"
                      }`}>
                        {i + 1}
                      </div>
                    )}
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                  {i < 2 && <div className="w-8 h-px bg-border" />}
                </div>
              ))}
            </div>
          )}

          {/* Step content */}
          {autoStep === 0 && renderAutoStepBasics()}
          {autoStep === 1 && renderAutoStepServerTypes()}
          {autoStep === 2 && renderAutoStepInvoice()}
          {autoStep === 3 && renderAutoStepProvisioning()}

          {/* Navigation */}
          {autoStep < 3 && (
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (autoStep === 0) {
                    setProvisioningMode("manual");
                  } else {
                    setAutoStep((s) => s - 1);
                  }
                }}
              >
                <ArrowLeft className="size-4 mr-1" />
                {autoStep === 0 ? "Back to Manual" : "Back"}
              </Button>
              {autoStep < 2 ? (
                <Button
                  onClick={() => setAutoStep((s) => s + 1)}
                  disabled={
                    (autoStep === 0 && !canProceedAutoBasics()) ||
                    (autoStep === 1 && !canProceedAutoServerTypes())
                  }
                >
                  Next
                  <ArrowRight className="size-4 ml-1" />
                </Button>
              ) : (
                <Button
                  onClick={handleProvision}
                  disabled={provisionCluster.isPending}
                  size="lg"
                >
                  {provisionCluster.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Provisioning...
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="size-4 mr-2" />
                      Provision & Create Cluster
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clusters</h1>
        <p className="text-muted-foreground">
          Manage your PostgreSQL HA clusters
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center border-b gap-1">
        <div className="flex gap-1">
          {([
            { id: "active" as const, label: "Active Clusters" },
            { id: "draft" as const, label: "Draft Clusters" },
          ]).map((tab) => {
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
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 mb-1"
            onClick={() => {
              setProvisioningMode("automatic");
              setAutoStep(0);
              setDialogOpen(true);
            }}
          >
            <Zap className="size-4" />
            Automatic
          </Button>
          <Button
            size="sm"
            className="gap-2 mb-1"
            onClick={() => {
              setProvisioningMode("manual");
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            New Cluster
          </Button>
        </div>
      </div>

      {clusters.isLoading && (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Skeleton className="size-5 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {clusters.data && clusters.data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Database className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">
              No clusters yet. Create your first HA cluster.
            </p>
          </CardContent>
        </Card>
      )}

      {clusters.data && clusters.data.length > 0 && activeTab === "active" && (
        activeClusters.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Database className="size-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">No active clusters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {activeClusters.map((cluster: any) => (
              <ClusterCard key={cluster.id} cluster={cluster} onDeleted={() => clusters.refetch()} />
            ))}
          </div>
        )
      )}

      {clusters.data && clusters.data.length > 0 && activeTab === "draft" && (
        draftClusters.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Server className="size-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">No draft clusters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {draftClusters.map((cluster: any) => (
              <ClusterCard key={cluster.id} cluster={cluster} onDeleted={() => clusters.refetch()} />
            ))}
          </div>
        )
      )}

      {renderDialog()}
    </div>
  );
}
