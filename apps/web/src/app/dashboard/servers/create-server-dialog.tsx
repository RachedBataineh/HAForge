"use client";

import { Button } from "@HAForge/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  SelectValue,
} from "@HAForge/ui/components/select";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { trpc, trpcClient } from "@/utils/trpc";

interface CreateServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiToken: string;
  onCreated: () => void;
}

export function CreateServerDialog({ open, onOpenChange, apiToken, onCreated }: CreateServerDialogProps) {
  const [name, setName] = useState("");
  const [serverType, setServerType] = useState("");
  const [location, setLocation] = useState("");
  const [image, setImage] = useState("");
  const [sshKeyId, setSshKeyId] = useState("");
  const [selectedArch, setSelectedArch] = useState("x86");

  const enabled = !!apiToken;

  const serverTypes = useQuery(
    trpc.cluster.hetznerServerTypes.queryOptions({ apiToken }, { enabled }),
  );
  const locations = useQuery(
    trpc.cluster.hetznerLocations.queryOptions({ apiToken }, { enabled }),
  );
  const images = useQuery(
    trpc.cluster.hetznerImages.queryOptions({ apiToken, architecture: selectedArch }, { enabled }),
  );
  const sshKeys = useQuery(
    trpc.cluster.hetznerSshKeys.queryOptions({ apiToken }, { enabled }),
  );

  const serverTypesData = (serverTypes.data ?? []) as any[];
  const locationsData = (locations.data ?? []) as any[];
  const imagesData = (images.data ?? []) as any[];
  const sshKeysData = (sshKeys.data ?? []) as any[];

  const [creating, setCreating] = useState(false);

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setName("");
      setServerType("");
      setLocation("");
      setImage("");
      setSshKeyId("");
      setSelectedArch("x86");
    }
    onOpenChange(val);
  };

  const handleCreate = async () => {
    if (!name || !serverType || !location || !image) {
      toast.error("Please fill in all required fields");
      return;
    }
    setCreating(true);
    try {
      await trpcClient.cluster.hetznerCreateServer.mutate({
        apiToken,
        name,
        serverType,
        location,
        image,
        sshKeyId: sshKeyId || undefined,
      });
      toast.success(`Server "${name}" created successfully`);
      onCreated();
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const loading = serverTypes.isLoading || locations.isLoading || images.isLoading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Hetzner Server</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading options...
          </div>
        )}

        {!loading && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-sm">Name</Label>
              <Input
                placeholder="my-server"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Server Type</Label>
              <Select value={serverType} onValueChange={(v) => {
                setServerType(v ?? "");
                const selected = serverTypesData.find((t: any) => t.name === v);
                if (selected?.architecture) {
                  setSelectedArch(selected.architecture);
                  setImage("");
                }
              }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select server type" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {serverTypesData.map((t: any) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.description} ({t.architecture}) — {t.cores} vCPU, {t.memory}GB RAM, {t.disk}GB disk
                      {t.price && ` (€${t.price}/mo)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Location</Label>
              <Select value={location} onValueChange={(v) => setLocation(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locationsData.map((l: any) => (
                    <SelectItem key={l.name} value={l.name}>
                      {l.city}, {l.country} ({l.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">Image</Label>
              <Select value={image} onValueChange={(v) => setImage(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select OS image" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {imagesData.map((i: any) => (
                    <SelectItem key={String(i.id)} value={String(i.id)}>
                      {i.description || i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="text-sm">SSH Key</Label>
              <Select value={sshKeyId} onValueChange={(v) => setSshKeyId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select SSH key" />
                </SelectTrigger>
                <SelectContent>
                  {sshKeysData.map((k: any) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name || !serverType || !location || !image || !sshKeyId || creating || loading}
          >
            {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
            Create Server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
