"use client";

import { Button } from "@HAForge/ui/components/button";
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
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

interface DeleteClusterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterName: string;
  onConfirm: () => void;
}

export function DeleteClusterDialog({ open, onOpenChange, clusterName, onConfirm }: DeleteClusterDialogProps) {
  const [input, setInput] = useState("");
  const confirmed = input === clusterName;

  const handleOpenChange = (val: boolean) => {
    if (!val) setInput("");
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Delete Draft Cluster
          </DialogTitle>
          <DialogDescription>
            This will permanently delete this draft cluster and remove all its server configuration. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <Label htmlFor="confirm-name" className="text-sm">
            Type <span className="font-mono font-semibold">{clusterName}</span> to confirm
          </Label>
          <Input
            id="confirm-name"
            placeholder={clusterName}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && confirmed) { onConfirm(); handleOpenChange(false); } }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => { onConfirm(); handleOpenChange(false); }}
            disabled={!confirmed}
          >
            Delete Cluster
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
