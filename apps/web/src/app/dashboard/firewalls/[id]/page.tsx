"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { ArrowLeft, Shield, Loader2, Trash2, Plus, Server, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

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
          {/* Inbound Rules */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowDownToLine className="size-4" />
                  Inbound Rules
                </CardTitle>
                <CardDescription>{data.inboundRules.length} rule{data.inboundRules.length !== 1 ? "s" : ""}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {data.inboundRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No inbound rules. All inbound traffic is blocked.</p>
              ) : (
                <div className="space-y-2">
                  {data.inboundRules.map((rule: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                      <Badge variant="secondary" className="w-12 justify-center">{rule.protocol.toUpperCase()}</Badge>
                      <span className="font-mono text-xs">{rule.port || "All"}</span>
                      <span className="text-xs text-muted-foreground flex-1 truncate">{rule.sourceIps.join(", ") || "0.0.0.0/0"}</span>
                      {rule.description && <span className="text-xs text-muted-foreground truncate">{rule.description}</span>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Outbound Rules */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowUpFromLine className="size-4" />
                  Outbound Rules
                </CardTitle>
                <CardDescription>{data.outboundRules.length} rule{data.outboundRules.length !== 1 ? "s" : ""}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {data.outboundRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No outbound rules. All outbound traffic is allowed.</p>
              ) : (
                <div className="space-y-2">
                  {data.outboundRules.map((rule: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                      <Badge variant="secondary" className="w-12 justify-center">{rule.protocol.toUpperCase()}</Badge>
                      <span className="font-mono text-xs">{rule.port || "All"}</span>
                      <span className="text-xs text-muted-foreground flex-1 truncate">{rule.destinationIps.join(", ") || "0.0.0.0/0"}</span>
                      {rule.description && <span className="text-xs text-muted-foreground truncate">{rule.description}</span>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
