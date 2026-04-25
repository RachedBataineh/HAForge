"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@HAForge/ui/components/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@HAForge/ui/components/dialog";
import { ArrowLeft, ArrowUpDown, Loader2, Link, Unlink, Trash2, ExternalLink, Copy } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

export default function FloatingIpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: floatingIpId } = React.use(params);
  const router = useRouter();

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = !!profile.data?.hetznerApiToken;

  const ip = useQuery(
    trpc.floatingIp.details.queryOptions(
      { floatingIpId },
      { enabled: hasToken },
    ),
  );
  const ipList = useQuery(
    trpc.floatingIp.list.queryOptions(undefined, { enabled: hasToken }),
  );

  const invalidate = () => {
    ip.refetch();
    ipList.refetch();
  };

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
    return <div className="p-6"><p className="text-muted-foreground">Add your Hetzner API token in Settings first.</p></div>;
  }

  if (ip.isLoading) {
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
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  const data = ip.data;
  if (!data) {
    return <div className="p-6"><p className="text-muted-foreground">Floating IP not found.</p></div>;
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
              <h1 className="text-2xl font-bold tracking-tight">{data.name || data.ip}</h1>
              <Badge variant={data.type === "ipv4" ? "default" : "secondary"}>{data.type.toUpperCase()}</Badge>
              {data.protection && <Badge variant="outline">Protected</Badge>}
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{data.ip}</p>
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">IP Address</span>
                <div className="flex items-center gap-2">
                  <p className="font-mono">{data.ip}</p>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => { navigator.clipboard.writeText(data.ip); toast.success("IP copied"); }}
                  >
                    <Copy className="size-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Type</span>
                <p>{data.type.toUpperCase()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Home Location</span>
                <p>{data.homeLocationCity}, {data.homeLocationCountry} ({data.homeLocation})</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created</span>
                <p>{new Date(data.created).toLocaleDateString()}</p>
              </div>
              {data.description && (
                <div>
                  <span className="text-muted-foreground">Description</span>
                  <p>{data.description}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Blocked</span>
                <p>{data.blocked ? "Yes" : "No"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Assignment & Reverse DNS */}
        <div className="grid grid-cols-2 gap-6">
          <AssignmentCard data={data} floatingIpId={floatingIpId} onDone={invalidate} router={router} />
          <ReverseDnsCard data={data} floatingIpId={floatingIpId} onDone={invalidate} />
        </div>

        {/* Danger Zone */}
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete this Floating IP</p>
                <p className="text-xs text-muted-foreground mt-1">Permanently release this IP address. This action cannot be undone.</p>
              </div>
              <DeleteButton floatingIpId={floatingIpId} ip={data.ip} name={data.name || data.ip} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ─── Assignment Card ──────────────────────────────── */

function AssignmentCard({ data, floatingIpId, onDone, router }: any) {
  const [assignOpen, setAssignOpen] = useState(false);

  const unassignMutation = useMutation({
    mutationFn: async () => {
      await trpcClient.floatingIp.unassign.mutate({ floatingIpId });
    },
    onSuccess: () => { toast.success("Floating IP unassigned"); onDone(); },
    onError: (err: any) => toast.error(err.message),
  });

  const availableServers = (data.allServers || []);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Assignment</CardTitle>
          {data.serverId ? (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => unassignMutation.mutate()} disabled={unassignMutation.isPending}>
              {unassignMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}
              Unassign
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setAssignOpen(true)}>
              <Link className="size-3.5" /> Assign
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {data.serverId ? (
            <div className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => router.push(`/dashboard/servers/hetzner-${data.serverId}`)}
            >
              <ArrowUpDown className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{data.serverName || data.serverId}</p>
                <p className="text-xs text-muted-foreground">Server ID: {data.serverId}</p>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground ml-auto" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This floating IP is not assigned to any server.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Assign to Server</DialogTitle></DialogHeader>
          <AssignServerForm
            floatingIpId={floatingIpId}
            servers={availableServers}
            onDone={() => { setAssignOpen(false); onDone(); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AssignServerForm({ floatingIpId, servers, onDone }: any) {
  const [serverId, setServerId] = useState("");
  const [attaching, setAttaching] = useState(false);

  const handleAssign = async () => {
    if (!serverId) { toast.error("Select a server"); return; }
    setAttaching(true);
    try {
      await trpcClient.floatingIp.assign.mutate({ floatingIpId, serverId });
      toast.success("Floating IP assigned");
      onDone();
    } catch (err: any) { toast.error(err.message); }
    finally { setAttaching(false); }
  };

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label className="text-sm">Server</Label>
          <Select value={serverId} onValueChange={(v) => setServerId(v ?? "")}>
            <SelectTrigger className="w-full">
              {serverId
                ? <span>{servers.find((s: any) => s.id === serverId)?.name || serverId}</span>
                : <span className="text-muted-foreground">Select a server</span>}
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              {servers.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.publicIp})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={handleAssign} disabled={!serverId || attaching}>
          {attaching ? <Loader2 className="size-4 animate-spin mr-2" /> : <Link className="size-4 mr-2" />} Assign
        </Button>
      </DialogFooter>
    </>
  );
}

/* ─── Reverse DNS Card ─────────────────────────────── */

function ReverseDnsCard({ data, floatingIpId, onDone }: any) {
  const [dnsOpen, setDnsOpen] = useState(false);
  const currentPtr = data.dnsPtr?.[0]?.ptr || "";

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Reverse DNS</CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setDnsOpen(true)}>
            Edit
          </Button>
        </CardHeader>
        <CardContent>
          {data.dnsPtr && data.dnsPtr.length > 0 ? (
            <div className="space-y-2">
              {data.dnsPtr.map((d: any, i: number) => (
                <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm font-mono">{d.ip}</span>
                  <span className="text-sm text-muted-foreground">{d.ptr}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No reverse DNS configured.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dnsOpen} onOpenChange={setDnsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Change Reverse DNS</DialogTitle></DialogHeader>
          <ReverseDnsForm
            floatingIpId={floatingIpId}
            ip={data.ip}
            currentPtr={currentPtr}
            onDone={() => { setDnsOpen(false); onDone(); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReverseDnsForm({ floatingIpId, ip, currentPtr, onDone }: any) {
  const [ptr, setPtr] = useState(currentPtr);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await trpcClient.floatingIp.changeReverseDns.mutate({ floatingIpId, ip, dnsPtr: ptr });
      toast.success("Reverse DNS updated");
      onDone();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label className="text-sm">IP Address</Label>
          <Input value={ip} disabled />
        </div>
        <div className="grid gap-2">
          <Label className="text-sm">Reverse DNS (PTR)</Label>
          <Input placeholder="mail.example.com" value={ptr} onChange={(e) => setPtr(e.target.value)} />
          <p className="text-xs text-muted-foreground">The hostname that this IP resolves to in reverse lookups.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Save
        </Button>
      </DialogFooter>
    </>
  );
}

/* ─── Delete Button ─────────────────────────────────── */

function DeleteButton({ floatingIpId, ip, name }: any) {
  const router = useRouter();
  const ipList = useQuery(trpc.floatingIp.list.queryOptions());
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await trpcClient.floatingIp.delete.mutate({ floatingIpId });
    },
    onSuccess: () => {
      toast.success("Floating IP deleted");
      ipList.refetch();
      router.push("/dashboard/floating-ips");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>Delete</Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirm(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete Floating IP</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Type <span className="font-mono font-semibold">{name}</span> to confirm deletion.
          </p>
          <Input placeholder={name} value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && confirm === name) deleteMutation.mutate(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setConfirm(""); }}>Cancel</Button>
            <Button variant="destructive" disabled={confirm !== name || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Trash2 className="size-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
