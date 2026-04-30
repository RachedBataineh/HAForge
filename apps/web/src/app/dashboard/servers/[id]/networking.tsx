"use client";

import { Card, CardContent } from "@HAForge/ui/components/card";
import { Terminal } from "lucide-react";

export default function NetworkingTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Networking</h2>
          <p className="text-sm text-muted-foreground">Firewall status and listening ports</p>
        </div>
      </div>

      <Card>
        <CardContent className="py-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Terminal className="size-8" />
          <p className="text-sm font-medium">Use the WebSocket Terminal</p>
          <p className="text-xs text-center max-w-md">
            Networking info is now available via the terminal tab. Use the terminal to run commands like{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">sudo ufw status</code> and{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">ss -tlnp</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
