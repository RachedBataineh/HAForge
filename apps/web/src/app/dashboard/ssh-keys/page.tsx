"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { KeyRound, Plus, Trash2, Loader2, Eye, Copy, CheckCircle2, AlertTriangle, Settings } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

export default function SshKeysPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<any>(null);
  const [addPrivateKeyOpen, setAddPrivateKeyOpen] = useState(false);
  const [addPrivateKeyValue, setAddPrivateKeyValue] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<any>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [newPublicKey, setNewPublicKey] = useState("");
  const [newPrivateKey, setNewPrivateKey] = useState("");

  const sshKeys = useQuery(trpc.cluster.allHetznerSshKeys.queryOptions());
  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const hasToken = !!profile.data?.hetznerApiToken;
  const keys = (sshKeys.data ?? []) as any[];

  const createKey = useMutation({
    mutationFn: async () => {
      return await trpcClient.cluster.hetznerCreateSshKey.mutate({
        name: newKeyName,
        publicKey: newPublicKey,
        privateKey: newPrivateKey || undefined,
      });
    },
    onSuccess: () => {
      toast.success("SSH key created");
      sshKeys.refetch();
      setCreateOpen(false);
      setNewKeyName("");
      setNewPublicKey("");
      setNewPrivateKey("");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ keyId, hetznerKeyId }: { keyId: string; hetznerKeyId?: string }) => {
      if (hetznerKeyId) {
        await trpcClient.cluster.hetznerDeleteSshKey.mutate({ keyId: hetznerKeyId });
      }
    },
    onSuccess: () => {
      toast.success("SSH key deleted");
      sshKeys.refetch();
      setDeleteKey(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const addPrivate = useMutation({
    mutationFn: async () => {
      return await trpcClient.cluster.addPrivateKey.mutate({
        keyId: detailKey.id,
        privateKey: addPrivateKeyValue,
      });
    },
    onSuccess: () => {
      toast.success("Private key added");
      sshKeys.refetch();
      setAddPrivateKeyOpen(false);
      setAddPrivateKeyValue("");
      setDetailKey(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const copyToClipboard = (field: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const keysWithPrivate = keys.filter((k: any) => k.privateKey).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SSH Keys</h1>
          <p className="text-muted-foreground">
            Manage SSH keys across your Hetzner projects
          </p>
        </div>
        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Add SSH Key
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold">{keys.length}</div>
            <p className="text-xs text-muted-foreground">Total SSH Keys</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-bold text-green-600">{keysWithPrivate}</div>
            <p className="text-xs text-muted-foreground">With Private Key</p>
          </CardContent>
        </Card>
      </div>

      {sshKeys.isLoading && (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!sshKeys.isLoading && keys.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <KeyRound className="size-12 text-muted-foreground/30 mx-auto" />
            <div className="space-y-1">
              <p className="font-medium">No SSH keys yet</p>
              <p className="text-sm text-muted-foreground">
                SSH keys are needed to connect to your servers via terminal and run deployment commands.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4 mr-2" />
                Add SSH Key
              </Button>
              {!hasToken && (
                <Button variant="outline" onClick={() => router.push("/dashboard/settings")}>
                  <Settings className="size-4 mr-2" />
                  Add Hetzner API Token
                </Button>
              )}
            </div>
            {hasToken && (
              <p className="text-xs text-muted-foreground">
                Keys from your Hetzner account will sync automatically.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {keys.length > 0 && (
        <div className="grid gap-3">
          {keys.map((key: any) => (
            <Card
              key={key.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setDetailKey(key)}
            >
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{key.name}</p>
                      {key.privateKey ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Ready</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">No Private Key</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteKey(key);
                      setDeleteConfirmInput("");
                    }}
                  >
                    <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Key Detail Dialog */}
      <Dialog open={!!detailKey} onOpenChange={(open) => { if (!open) setDetailKey(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5" />
              {detailKey?.name}
            </DialogTitle>
          </DialogHeader>
          {detailKey && (
            <div className="grid gap-4 py-2">
              {detailKey.fingerprint && (
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Fingerprint</Label>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{detailKey.fingerprint}</code>
                    <button onClick={() => copyToClipboard("fp", detailKey.fingerprint)} className="text-muted-foreground hover:text-foreground">
                      {copiedField === "fp" ? <CheckCircle2 className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Public Key</Label>
                <div className="relative">
                  <pre className="text-xs bg-muted p-3 rounded font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{detailKey.publicKey}</pre>
                  <button
                    onClick={() => copyToClipboard("pub", detailKey.publicKey)}
                    className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  >
                    {copiedField === "pub" ? <CheckCircle2 className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              </div>

              {detailKey.privateKey ? (
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Private Key</Label>
                  <div className="relative">
                    <pre className="text-xs bg-muted p-3 rounded font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{detailKey.privateKey}</pre>
                    <button
                      onClick={() => copyToClipboard("priv", detailKey.privateKey)}
                      className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                    >
                      {copiedField === "priv" ? <CheckCircle2 className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 p-4 rounded-lg border border-dashed">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium">No Private Key</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Add a private key to enable HAForge to SSH into servers using this key.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1 w-fit"
                    onClick={() => {
                      setAddPrivateKeyValue("");
                      setAddPrivateKeyOpen(true);
                    }}
                  >
                    <Plus className="size-3.5 mr-1" />
                    Add Private Key
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Private Key Dialog */}
      <Dialog open={addPrivateKeyOpen} onOpenChange={setAddPrivateKeyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Private Key</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-sm">Private Key for: {detailKey?.name}</Label>
              <textarea
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                value={addPrivateKeyValue}
                onChange={(e) => setAddPrivateKeyValue(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPrivateKeyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => addPrivate.mutate()} disabled={!addPrivateKeyValue.trim() || addPrivate.isPending}>
              {addPrivate.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <KeyRound className="size-4 mr-2" />}
              Save Private Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create SSH Key Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add SSH Key</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-sm">Name</Label>
              <Input
                placeholder="my-laptop"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-sm">Public Key</Label>
              <Input
                placeholder="ssh-ed25519 AAAA..."
                value={newPublicKey}
                onChange={(e) => setNewPublicKey(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-sm">Private Key</Label>
              <textarea
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                value={newPrivateKey}
                onChange={(e) => setNewPrivateKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">HAForge uses this to SSH into your servers during deployment.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createKey.mutate()}
              disabled={!newKeyName.trim() || !newPublicKey.trim() || createKey.isPending}
            >
              {createKey.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
              Add Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteKey} onOpenChange={(open) => { if (!open) setDeleteKey(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Delete SSH Key
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the SSH key from both Hetzner and HAForge. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Label className="text-sm">
              Type <span className="font-mono font-semibold">{deleteKey?.name}</span> to confirm
            </Label>
            <Input
              placeholder={deleteKey?.name}
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && deleteConfirmInput === deleteKey?.name && deleteKey) {
                  deleteMutation.mutate({ keyId: deleteKey.id, hetznerKeyId: deleteKey.hetznerKeyId || undefined });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteKey(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteKey) deleteMutation.mutate({ keyId: deleteKey.id, hetznerKeyId: deleteKey.hetznerKeyId || undefined }); }}
              disabled={deleteConfirmInput !== deleteKey?.name || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Trash2 className="size-4 mr-2" />}
              Delete Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
