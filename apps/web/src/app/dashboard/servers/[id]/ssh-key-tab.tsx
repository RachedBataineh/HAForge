"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@HAForge/ui/components/select";
import { KeyRound, Check, Unplug } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

interface SshKeyTabProps {
  hetznerServerId: string;
  currentSshKeyId: string | null;
  ipAddress?: string;
  privateIpAddress?: string;
}

export default function SshKeyTab({ hetznerServerId, currentSshKeyId, ipAddress, privateIpAddress }: SshKeyTabProps) {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(currentSshKeyId);

  // Fetch SSH keys with private keys
  const dbSshKeys = useQuery(trpc.cluster.allHetznerSshKeys.queryOptions());
  const sshKeyOptions = ((dbSshKeys.data ?? []) as any[]).filter((k: any) => k.privateKey);
  const currentKey = sshKeyOptions.find((k: any) => k.id === selectedKey);

  const assignMutation = useMutation({
    mutationFn: async (sshKeyId: string | null) => {
      return await trpcClient.server.assignSshKey.mutate({ hetznerServerId, sshKeyId, ipAddress, privateIpAddress });
    },
    onSuccess: (_, sshKeyId) => {
      setSelectedKey(sshKeyId);
      queryClient.invalidateQueries({ queryKey: ["server"] });
      queryClient.invalidateQueries({ queryKey: ["cluster"] });
      toast.success(sshKeyId ? "SSH key assigned" : "SSH key removed");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="size-4" />
            SSH Key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Assign an SSH key to this server. When deploying a cluster, the system will
            automatically use this key to connect.
          </p>

          <div className="grid gap-2">
            <Select
              value={selectedKey || "__none__"}
              onValueChange={(v) => {
                const newKey = v === "__none__" ? null : v;
                assignMutation.mutate(newKey);
              }}
            >
              <SelectTrigger className="w-full">
                {selectedKey
                  ? <span className="truncate">{sshKeyOptions.find((k: any) => k.id === selectedKey)?.name || "Unknown key"}</span>
                  : <span className="text-muted-foreground">No SSH key assigned</span>}
              </SelectTrigger>
              <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {sshKeyOptions.map((k: any) => (
                  <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {sshKeyOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No SSH keys with private keys found.{" "}
                <a href="/dashboard/ssh-keys" className="underline hover:no-underline" target="_blank">Add one</a>.
              </p>
            )}
          </div>

          {selectedKey && currentKey && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Check className="size-4 text-green-600" />
                <span className="font-medium text-sm">{currentKey.name}</span>
                <Badge variant="secondary">Assigned</Badge>
              </div>
              {currentKey.fingerprint && (
                <div>
                  <span className="text-xs text-muted-foreground">Fingerprint</span>
                  <p className="text-xs font-mono mt-0.5">{currentKey.fingerprint}</p>
                </div>
              )}
              {currentKey.publicKey && (
                <div>
                  <span className="text-xs text-muted-foreground">Public Key</span>
                  <p className="text-xs font-mono mt-0.5 break-all">{currentKey.publicKey.slice(0, 80)}...</p>
                </div>
              )}
            </div>
          )}

          {!selectedKey && (
            <div className="rounded-lg border border-dashed p-4 flex items-center gap-3">
              <Unplug className="size-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">No SSH key assigned</p>
                <p className="text-xs text-muted-foreground">This server cannot be used in cluster deployment until an SSH key is assigned.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
