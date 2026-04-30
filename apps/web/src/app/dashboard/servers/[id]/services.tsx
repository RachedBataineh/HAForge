"use client";

import { Card, CardContent } from "@HAForge/ui/components/card";
import { Terminal } from "lucide-react";

const SERVICES = [
  { name: "PostgreSQL", service: "postgresql", icon: "🐘" },
  { name: "Patroni", service: "patroni", icon: "🔄" },
  { name: "etcd", service: "etcd", icon: "🗄️" },
  { name: "HAProxy", service: "haproxy", icon: "⚖️" },
  { name: "Keepalived", service: "keepalived", icon: "💡" },
];

export default function ServicesTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Services</h2>
          <p className="text-sm text-muted-foreground">Service status and management via SSH</p>
        </div>
      </div>

      <Card>
        <CardContent className="py-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Terminal className="size-8" />
          <p className="text-sm font-medium">Use the WebSocket Terminal</p>
          <p className="text-xs text-center max-w-md">
            Service management is now available via the terminal tab. Use the terminal to run commands like{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">systemctl status {"{service}"}</code> and{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">sudo systemctl restart {"{service}"}</code>.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 justify-center">
            {SERVICES.map((s) => (
              <span key={s.service} className="text-xs bg-muted/50 rounded px-2 py-1">
                {s.icon} {s.name}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
