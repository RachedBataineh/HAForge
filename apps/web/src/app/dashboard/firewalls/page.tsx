"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Shield, Plus, Loader2, Trash2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import React, { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { trpc, trpcClient } from "@/utils/trpc";

export default function FirewallsPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFw, setDeleteFw] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = profile.data?.hasHetznerToken ?? false;

  const firewalls = useQuery(
    trpc.firewall.list.queryOptions(undefined, { enabled: hasToken }),
  );

  const fwList = (firewalls.data ?? []) as any[];

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      return await trpcClient.firewall.delete.mutate({ firewallId: id });
    },
    onSuccess: () => {
      toast.success("Firewall deleted");
      firewalls.refetch();
      setDeleteOpen(false);
      setDeleteFw(null);
      setDeleteConfirm("");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  if (profile.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Firewalls</h1>
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Firewalls</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">Add your Hetzner API token in Settings to manage firewalls.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Firewalls</h1>
          <p className="text-muted-foreground">Manage Hetzner Cloud Firewalls</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Create Firewall
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold">{fwList.length}</div>
            <p className="text-xs text-muted-foreground">Total Firewalls</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold text-green-600">{fwList.reduce((sum: number, fw: any) => sum + fw.appliedToCount, 0)}</div>
            <p className="text-xs text-muted-foreground">Total Server Applications</p>
          </CardContent>
        </Card>
      </div>

      {firewalls.isLoading && (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!firewalls.isLoading && fwList.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No firewalls found. Create one to get started.</p>
          </CardContent>
        </Card>
      )}

      {fwList.length > 0 && (
        <div className="grid gap-3">
          {fwList.map((fw: any) => (
            <Card key={fw.id} className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/firewalls/${fw.id}`)}
            >
              <CardContent className="flex items-center py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Shield className="size-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{fw.name}</p>
                    <p className="text-xs text-muted-foreground">{fw.rulesCount} rule{fw.rulesCount !== 1 ? "s" : ""} &middot; Applied to {fw.appliedToCount} server{fw.appliedToCount !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-auto">
                  <span className="text-xs text-muted-foreground">{new Date(fw.created).toLocaleDateString()}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteFw({ id: fw.id, name: fw.name });
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Firewall</DialogTitle>
          </DialogHeader>
          <CreateFirewallForm
            onCreated={() => {
              firewalls.refetch();
              setCreateOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) { setDeleteFw(null); setDeleteConfirm(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Firewall</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type <span className="font-mono font-semibold">{deleteFw?.name}</span> to confirm deletion.
          </p>
          <Input
            placeholder={deleteFw?.name}
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && deleteConfirm === deleteFw?.name && deleteFw) {
                deleteMutation.mutate({ id: deleteFw.id });
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteFw(null); setDeleteConfirm(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== deleteFw?.name || deleteMutation.isPending}
              onClick={() => { if (deleteFw) deleteMutation.mutate({ id: deleteFw.id }); }}
            >
              {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Create Form ──────────────────────────────────── */

interface Rule {
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "icmp" | "esp" | "gre";
  port: string;
  sourceIps: string;
  description: string;
}

const DEFAULT_RULE: Rule = { direction: "in", protocol: "tcp", port: "", sourceIps: "0.0.0.0/0", description: "" };

function CreateFirewallForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [rules, setRules] = useState<Rule[]>([{ ...DEFAULT_RULE }]);
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const servers = useQuery(trpc.cluster.hetznerServers.queryOptions());
  const serversData = (servers.data ?? []) as any[];

  const addRule = () => setRules([...rules, { ...DEFAULT_RULE }]);
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const updateRule = (i: number, field: keyof Rule, value: string) => {
    if (!value) return;
    const updated = [...rules];
    updated[i] = { ...updated[i], [field]: value };
    setRules(updated);
  };

  const toggleServer = (id: string) => {
    setServerIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Enter a name"); return; }
    setCreating(true);
    try {
      await trpcClient.firewall.create.mutate({
        name: name.trim(),
        rules: rules.map((r) => ({
          direction: r.direction,
          protocol: r.protocol,
          port: r.port || undefined,
          source_ips: r.direction === "in" && r.sourceIps ? r.sourceIps.split(",").map((s) => s.trim()) : undefined,
          destination_ips: r.direction === "out" && r.sourceIps ? r.sourceIps.split(",").map((s) => s.trim()) : undefined,
          description: r.description || undefined,
        })),
        applyToServerIds: serverIds.length > 0 ? serverIds : undefined,
      });
      toast.success("Firewall created");
      onCreated();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="grid gap-4 py-2 max-h-[60vh] overflow-auto">
        <div className="grid gap-2">
          <Label className="text-sm">Name</Label>
          <Input placeholder="my-firewall" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Rules</Label>
            <Button variant="outline" size="sm" onClick={addRule} className="gap-1">
              <Plus className="size-3.5" /> Add Rule
            </Button>
          </div>
          {rules.map((rule, i) => (
            <div key={i} className="grid gap-2 border rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Select value={rule.direction} onValueChange={(v) => v && updateRule(i, "direction", v)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Inbound</SelectItem>
                    <SelectItem value="out">Outbound</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={rule.protocol} onValueChange={(v) => v && updateRule(i, "protocol", v)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="icmp">ICMP</SelectItem>
                    <SelectItem value="esp">ESP</SelectItem>
                    <SelectItem value="gre">GRE</SelectItem>
                  </SelectContent>
                </Select>
                {!["icmp", "esp", "gre"].includes(rule.protocol) && (
                  <Input className="w-28" placeholder="Port (e.g. 22)" value={rule.port} onChange={(e) => updateRule(i, "port", e.target.value)} />
                )}
                {rules.length > 1 && (
                  <Button variant="ghost" size="icon-sm" onClick={() => removeRule(i)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              <Input
                placeholder={rule.direction === "in" ? "Source IPs (comma-separated, e.g. 0.0.0.0/0)" : "Destination IPs (comma-separated, e.g. 0.0.0.0/0)"}
                value={rule.sourceIps}
                onChange={(e) => updateRule(i, "sourceIps", e.target.value)}
              />
              <Input
                placeholder="Description (optional)"
                value={rule.description}
                onChange={(e) => updateRule(i, "description", e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Apply to Servers (optional)</Label>
          {serversData.length === 0 && <p className="text-xs text-muted-foreground">No servers available</p>}
          <div className="grid gap-1 max-h-32 overflow-auto">
            {serversData.map((s: any) => (
              <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-2 py-1">
                <input
                  type="checkbox"
                  checked={serverIds.includes(String(s.id))}
                  onChange={() => toggleServer(String(s.id))}
                  className="rounded"
                />
                <span>{s.name}</span>
                <span className="text-xs text-muted-foreground font-mono">{s.publicIp}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCreated}>Cancel</Button>
        <Button onClick={handleCreate} disabled={!name.trim() || creating}>
          {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
          Create
        </Button>
      </DialogFooter>
    </>
  );
}
