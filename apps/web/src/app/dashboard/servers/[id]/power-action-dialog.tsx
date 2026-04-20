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

interface PowerActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "poweroff" | "reboot";
  serverName: string;
  onConfirm: () => void;
}

export function PowerActionDialog({ open, onOpenChange, action, serverName, onConfirm }: PowerActionDialogProps) {
  const [input, setInput] = useState("");
  const confirmed = input === serverName;

  const handleOpenChange = (val: boolean) => {
    if (!val) setInput("");
    onOpenChange(val);
  };

  const label = action === "poweroff" ? "Power Off" : "Reboot";
  const description =
    action === "poweroff"
      ? "This will immediately shut down the server. All running services will be interrupted and any unsaved data may be lost."
      : "This will restart the server. All running services will be temporarily interrupted.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Confirm {label}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <Label htmlFor="confirm-name" className="text-sm">
            Type <span className="font-mono font-semibold">{serverName}</span> to confirm
          </Label>
          <Input
            id="confirm-name"
            placeholder={serverName}
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
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
