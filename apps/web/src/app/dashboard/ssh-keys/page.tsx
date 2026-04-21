"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@HAForge/ui/components/dialog";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { KeyRound, Plus, Trash2, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

export default function SshKeysPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newPublicKey, setNewPublicKey] = useState("");
  const [newPrivateKey, setNewPrivateKey] = useState("");

  const sshKeys = useQuery(trpc.cluster.allHetznerSshKeys.queryOptions());
  const keys = (sshKeys.data ?? []) as any[];

  // Get API token from allHetznerServers
  const hetznerServers = useQuery(trpc.cluster.allHetznerServers.queryOptions());
  const apiToken = (hetznerServers.data as any)?.apiToken || "";

  const createKey = useMutation({
    mutationFn: async () => {
      return await trpcClient.cluster.hetznerCreateSshKey.mutate({
        apiToken,
        name: newKeyName,
        publicKey: newPublicKey,
        privateKey: newPrivateKey,
      });
    },
    onSuccess: () => {
      toast.success("SSH key created");
      queryClient.invalidateQueries(trpc.cluster.allHetznerSshKeys.queryFilter());
      setCreateOpen(false);
      setNewKeyName("");
      setNewPublicKey("");
      setNewPrivateKey("");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteKey = useMutation({
    mutationFn: async ({ keyId, token }: { keyId: string; token: string }) => {
      return await trpcClient.cluster.hetznerDeleteSshKey.mutate({ apiToken: token, keyId });
    },
    onSuccess: () => {
      toast.success("SSH key deleted");
      queryClient.invalidateQueries(trpc.cluster.allHetznerSshKeys.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SSH Keys</h1>
          <p className="text-muted-foreground">
            Manage SSH keys across your Hetzner projects
          </p>
        </div>
        <Button className="gap-2" onClick={() => setCreateOpen(true)} disabled={!apiToken}>
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
      </div>

      {sshKeys.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading SSH keys...
          </CardContent>
        </Card>
      )}

      {!sshKeys.isLoading && keys.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <KeyRound className="size-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No SSH keys found. Create a cluster with an API token or add a key manually.</p>
          </CardContent>
        </Card>
      )}

      {keys.length > 0 && (
        <div className="grid gap-3">
          {keys.map((key: any) => (
            <Card key={key.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{key.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {key.createdAt && (
                    <span className="text-xs text-muted-foreground">
                      Added {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (confirm(`Delete SSH key "${key.name}"?`)) {
                        deleteKey.mutate({ keyId: key.id, token: apiToken });
                      }
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
              disabled={!newKeyName.trim() || !newPublicKey.trim() || !newPrivateKey.trim() || createKey.isPending}
            >
              {createKey.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
              Add Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
