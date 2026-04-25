"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { ArrowLeft, Shield, Loader2, Trash2, Plus, Server, ArrowDownToLine, ArrowUpFromLine, Save, X } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

interface Rule {
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "icmp" | "esp" | "gre";
  port: string;
  portRange: string;
  ips: string;
  description: string;
}

export default function FirewallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: firewallId } = React.use(params);
  const router = useRouter();

  const fw = useQuery(trpc.firewall.details.queryOptions({ firewallId }));

  const invalidate = () => fw.refetch();

  if (fw.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  const data = fw.data;
  if (!data) {
    return <div className="p-6"><p className="text-muted-foreground">Firewall not found.</p></div>;
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
              <Badge variant="outline">{data.inboundRules.length + data.outboundRules.length} rules</Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">Applied to {data.appliedServers.length} server{data.appliedServers.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DeleteFirewallButton firewallId={firewallId} name={data.name} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <RulesCard
            title="Inbound Rules"
            icon={<ArrowDownToLine className="size-4" />}
            direction="in"
            firewallId={firewallId}
            allInboundRules={data.inboundRules}
            allOutboundRules={data.outboundRules}
            onDone={invalidate}
          />
          <RulesCard
            title="Outbound Rules"
            icon={<ArrowUpFromLine className="size-4" />}
            direction="out"
            firewallId={firewallId}
            allInboundRules={data.inboundRules}
            allOutboundRules={data.outboundRules}
            onDone={invalidate}
          />
        </div>

        {/* Applied Servers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="size-4" />
                Applied Servers
              </CardTitle>
              <CardDescription>{data.appliedServers.length} server{data.appliedServers.length !== 1 ? "s" : ""}</CardDescription>
            </div>
            <ApplyServersButton firewallId={firewallId} currentServerIds={data.appliedServers.map((s: any) => s.id)} allServers={data.allServers} onDone={invalidate} />
          </CardHeader>
          <CardContent>
            {data.appliedServers.length === 0 ? (
              <p className="text-sm text-muted-foreground">This firewall is not applied to any servers.</p>
            ) : (
              <div className="grid gap-2">
                {data.appliedServers.map((server: any) => (
                  <div key={server.id} className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => router.push(`/dashboard/servers/hetzner-${server.id}`)}
                  >
                    <Server className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{server.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{server.publicIp}</span>
                    <Badge variant={server.status === "running" ? "default" : "secondary"} className="ml-auto">{server.status}</Badge>
                    <RemoveServerButton firewallId={firewallId} serverId={server.id} onDone={invalidate} />
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

/* ─── Rules Card with inline editing ──────────────── */

function RulesCard({
  title, icon, direction, firewallId, allInboundRules, allOutboundRules, onDone,
}: {
  title: string;
  icon: React.ReactNode;
  direction: "in" | "out";
  firewallId: string;
  allInboundRules: any[];
  allOutboundRules: any[];
  onDone: () => void;
}) {
  const apiRules = direction === "in" ? allInboundRules : allOutboundRules;
  const ipField = direction === "in" ? "sourceIps" : "destinationIps";

  const [editing, setEditing] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const toLocalRules = (apiRules: any[]): Rule[] =>
    apiRules.map((r: any) => {
      const rawPort = r.port || "";
      const isRange = rawPort.includes("-");
      return {
        direction,
        protocol: r.protocol || "tcp",
        port: isRange ? rawPort.split("-")[0].trim() : rawPort,
        portRange: isRange ? rawPort.split("-")[1].trim() : "",
        ips: (r[ipField] || []).join(", ") || "0.0.0.0/0, ::/0",
        description: r.description || "",
      };
    });

  useEffect(() => {
    if (!editing) {
      setRules(toLocalRules(apiRules));
      setHasChanges(false);
    }
  }, [apiRules, editing]);

  const startEdit = () => {
    setRules(toLocalRules(apiRules));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setHasChanges(false);
  };

  const addRule = () => {
    setRules([...rules, { direction, protocol: "tcp", port: "", portRange: "", ips: "0.0.0.0/0, ::/0", description: "" }]);
    setHasChanges(true);
  };

  const removeRule = (i: number) => {
    setRules(rules.filter((_, idx) => idx !== i));
    setHasChanges(true);
  };

  const updateRule = (i: number, field: keyof Rule, value: string) => {
    const updated = [...rules];
    updated[i] = { ...updated[i], [field]: value };
    // Clear port when switching to non-port protocols
    if (field === "protocol" && ["icmp", "esp", "gre"].includes(value)) {
      updated[i].port = "";
    }
    setRules(updated);
    setHasChanges(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const allRules = [
        ...(direction === "in"
          ? rules.map(r => r)
          : allInboundRules.map((r: any) => {
            const rawPort = r.port || "";
            const isRange = rawPort.includes("-");
            return { direction: "in" as const, protocol: r.protocol, port: isRange ? rawPort.split("-")[0].trim() : rawPort, portRange: isRange ? rawPort.split("-")[1].trim() : "", ips: (r.sourceIps || []).join(", ") || "0.0.0.0/0, ::/0", description: r.description || "" };
          })
        ),
        ...(direction === "out"
          ? rules.map(r => r)
          : allOutboundRules.map((r: any) => {
            const rawPort = r.port || "";
            const isRange = rawPort.includes("-");
            return { direction: "out" as const, protocol: r.protocol, port: isRange ? rawPort.split("-")[0].trim() : rawPort, portRange: isRange ? rawPort.split("-")[1].trim() : "", ips: (r.destinationIps || []).join(", ") || "0.0.0.0/0, ::/0", description: r.description || "" };
          })
        ),
      ];
      const payload = allRules.map((r) => {
        const p = (r.port || "").trim();
        const pr = (r.portRange || "").trim();
        let port: string | undefined;
        if (p && pr) {
          const start = Math.min(Number(p), Number(pr));
          const end = Math.max(Number(p), Number(pr));
          port = `${start}-${end}`;
        } else {
          port = p || pr || undefined;
        }
        return {
          direction: r.direction,
          protocol: r.protocol as "tcp" | "udp" | "icmp" | "esp" | "gre",
          port,
          source_ips: r.direction === "in" ? r.ips.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
          destination_ips: r.direction === "out" ? r.ips.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
          description: r.description || undefined,
        };
      });
      return trpcClient.firewall.update.mutate({
        firewallId,
        rules: payload,
      });
    },
    onSuccess: () => {
      toast.success("Rules updated");
      setEditing(false);
      setHasChanges(false);
      onDone();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const displayRules = editing ? rules : toLocalRules(apiRules);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">{icon} {title}</CardTitle>
          <CardDescription>{displayRules.length} rule{displayRules.length !== 1 ? "s" : ""}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={addRule} className="gap-1">
                <Plus className="size-3.5" /> Add Rule
              </Button>
              <Button variant="outline" size="sm" onClick={cancelEdit}>Cancel</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending} className="gap-1">
                {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={startEdit}>Edit Rules</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {displayRules.length === 0 && !editing ? (
          <p className="text-sm text-muted-foreground py-2">
            {direction === "in" ? "No inbound rules. All inbound traffic is blocked." : "No outbound rules. All outbound traffic is allowed."}
          </p>
        ) : (
          <div className="space-y-2">
            {displayRules.map((rule, i) => (
              editing ? (
                <RuleEditor key={i} rule={rule} index={i} direction={direction} onUpdate={(field, val) => updateRule(i, field, val)} onRemove={() => removeRule(i)} />
              ) : (
                <RuleDisplay key={i} rule={rule} direction={direction} />
              )
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Rule Display (read-only) ─────────────────────── */

function RuleDisplay({ rule, direction }: { rule: Rule; direction: "in" | "out" }) {
  const ips = rule.ips || "0.0.0.0/0, ::/0";
  const ipList = ips.split(",").map((s) => s.trim()).filter(Boolean);
  let portLabel = "";
  if (["icmp", "esp", "gre"].includes(rule.protocol)) {
    portLabel = "—";
  } else if (rule.port) {
    portLabel = rule.port;
  } else if (rule.portRange) {
    portLabel = rule.portRange;
  } else {
    portLabel = "Any";
  }

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
      <Badge variant="secondary" className="w-14 justify-center font-mono text-xs">{rule.protocol.toUpperCase()}</Badge>
      <span className="font-mono text-xs min-w-[60px]">{portLabel}</span>
      <div className="flex items-center gap-1.5 flex-1 flex-wrap">
        {ipList.map((ip, j) => (
          <Badge key={j} variant="outline" className="font-mono text-xs">
            {ip === "0.0.0.0/0" ? "Any IPv4" : ip === "::/0" ? "Any IPv6" : ip}
          </Badge>
        ))}
      </div>
      {rule.description && <span className="text-xs text-muted-foreground truncate max-w-[150px]">{rule.description}</span>}
    </div>
  );
}

/* ─── Rule Editor (inline) ─────────────────────────── */

function RuleEditor({ rule, index, direction, onUpdate, onRemove }: {
  rule: Rule;
  index: number;
  direction: "in" | "out";
  onUpdate: (field: keyof Rule, value: string) => void;
  onRemove: () => void;
}) {
  const needsPort = !["icmp", "esp", "gre"].includes(rule.protocol);

  return (
    <div className="rounded-md border p-3 space-y-2 bg-card">
      <div className="flex items-center gap-2">
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Protocol</Label>
          <Select value={rule.protocol} onValueChange={(v) => v && onUpdate("protocol", v)}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="udp">UDP</SelectItem>
              <SelectItem value="icmp">ICMP</SelectItem>
              <SelectItem value="esp">ESP</SelectItem>
              <SelectItem value="gre">GRE</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {needsPort && (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input className="w-24 h-8 text-xs font-mono" placeholder="e.g. 22" value={rule.port} onChange={(e) => onUpdate("port", e.target.value.replace(/[^\d]/g, ""))} />
          </div>
        )}
        {needsPort && (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">To Port</Label>
            <Input className="w-28 h-8 text-xs font-mono" placeholder="e.g. 50" value={rule.portRange} onChange={(e) => onUpdate("portRange", e.target.value.replace(/[^\d]/g, ""))} />
          </div>
        )}
        <div className="ml-auto">
          <Button variant="ghost" size="icon-sm" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">{direction === "in" ? "Source IPs" : "Destination IPs"}</Label>
        <div className="flex items-center gap-2">
          <Input className="flex-1 h-8 text-xs font-mono" value={rule.ips} onChange={(e) => onUpdate("ips", e.target.value)} placeholder="0.0.0.0/0, ::/0" />
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => {
            const current = rule.ips.split(",").map((s) => s.trim()).filter(Boolean);
            const hasV4 = current.includes("0.0.0.0/0");
            const newIps = hasV4 ? current.filter((ip) => ip !== "0.0.0.0/0") : [...current.filter((ip) => ip !== "0.0.0.0/0"), "0.0.0.0/0"];
            onUpdate("ips", newIps.join(", "));
          }}>
            {rule.ips.includes("0.0.0.0/0") ? "Any IPv4 ✓" : "Any IPv4"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => {
            const current = rule.ips.split(",").map((s) => s.trim()).filter(Boolean);
            const hasV6 = current.includes("::/0");
            const newIps = hasV6 ? current.filter((ip) => ip !== "::/0") : [...current.filter((ip) => ip !== "::/0"), "::/0"];
            onUpdate("ips", newIps.join(", "));
          }}>
            {rule.ips.includes("::/0") ? "Any IPv6 ✓" : "Any IPv6"}
          </Button>
        </div>
      </div>
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">Description</Label>
        <Input className="h-8 text-xs" placeholder="Optional description" value={rule.description} onChange={(e) => onUpdate("description", e.target.value)} />
      </div>
    </div>
  );
}

/* ─── Delete Firewall ──────────────────────────────── */

function DeleteFirewallButton({ firewallId, name }: { firewallId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: async () => trpcClient.firewall.delete.mutate({ firewallId }),
    onSuccess: () => {
      toast.success("Firewall deleted");
      router.push("/dashboard/firewalls");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>Delete</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirm(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete Firewall</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type <span className="font-mono font-semibold">{name}</span> to confirm deletion.
          </p>
          <Input placeholder={name} value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && confirm === name) mutation.mutate(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setConfirm(""); }}>Cancel</Button>
            <Button variant="destructive" disabled={confirm !== name || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Trash2 className="size-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Remove Server Button ─────────────────────────── */

function RemoveServerButton({ firewallId, serverId, onDone }: { firewallId: string; serverId: string; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: async () => trpcClient.firewall.removeFromResources.mutate({ firewallId, serverIds: [serverId] }),
    onSuccess: () => { toast.success("Server removed"); onDone(); },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); mutation.mutate(); }} disabled={mutation.isPending}>
      {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />}
    </Button>
  );
}

/* ─── Apply Servers Button ─────────────────────────── */

function ApplyServersButton({ firewallId, currentServerIds, allServers, onDone }: {
  firewallId: string;
  currentServerIds: string[];
  allServers: any[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const availableServers = allServers.filter((s: any) => !currentServerIds.includes(s.id));

  const mutation = useMutation({
    mutationFn: async () => trpcClient.firewall.applyToResources.mutate({ firewallId, serverIds: selected }),
    onSuccess: () => {
      toast.success("Firewall applied to servers");
      setOpen(false);
      setSelected([]);
      onDone();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggle = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Apply to Servers
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelected([]); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Apply to Servers</DialogTitle></DialogHeader>
          {availableServers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">All servers already have this firewall applied.</p>
          ) : (
            <div className="grid gap-1 max-h-48 overflow-auto">
              {availableServers.map((s: any) => (
                <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-2 py-1.5">
                  <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="rounded" />
                  <span>{s.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{s.publicIp}</span>
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setSelected([]); }}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={selected.length === 0 || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Apply ({selected.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
