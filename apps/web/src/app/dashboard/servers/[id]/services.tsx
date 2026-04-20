"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { CheckCircle2, XCircle, Loader2, RotateCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { trpcClient } from "@/utils/trpc";

const SERVICES = [
  { name: "PostgreSQL", service: "postgresql", icon: "🐘" },
  { name: "Patroni", service: "patroni", icon: "🔄" },
  { name: "etcd", service: "etcd", icon: "🗄️" },
  { name: "HAProxy", service: "haproxy", icon: "⚖️" },
  { name: "Keepalived", service: "keepalived", icon: "💡" },
];

interface ServiceStatus {
  name: string;
  service: string;
  icon: string;
  active: boolean;
}

export default function ServicesTab({ server }: { server: any }) {
  const [loading, setLoading] = useState(false);
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [restartService, setRestartService] = useState<string | null>(null);

  const sshExec = async (command: string) => {
    return await trpcClient.cluster.sshExec.mutate({
      host: server.ipAddress,
      port: server.sshPort || 22,
      username: server.sshUser || "root",
      privateKey: server.sshPrivateKey,
      command,
    });
  };

  const fetchServices = async () => {
    setLoading(true);
    try {
      const data = await sshExec(
        SERVICES.map((s) => `systemctl is-active ${s.service} 2>/dev/null || echo "inactive"`).join("\n"),
      );
      const lines = data.stdout.trim().split("\n");
      setServices(SERVICES.map((s, i) => ({
        ...s,
        active: (lines[i] || "").trim() === "active",
      })));
    } catch (err: any) {
      toast.error(`Failed to fetch services: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async (serviceName: string) => {
    setRestartService(serviceName);
    try {
      await sshExec(`sudo systemctl restart ${serviceName}`);
      toast.success(`${serviceName} restarted`);
      fetchServices();
    } catch (err: any) {
      toast.error(`Failed to restart ${serviceName}: ${err.message}`);
    } finally {
      setRestartService(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Services</h2>
          <p className="text-sm text-muted-foreground">Service status and management via SSH</p>
        </div>
        <Button variant="outline" onClick={fetchServices} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <RotateCw className="size-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {!services && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Click "Refresh" to fetch service status from the server.
          </CardContent>
        </Card>
      )}

      {loading && !services && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Fetching service status...
          </CardContent>
        </Card>
      )}

      {services && (
        <div className="grid gap-3">
          {services.map((s) => (
            <Card key={s.service}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{s.icon}</span>
                  <div>
                    <p className="font-medium text-sm">{s.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{s.service}.service</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={s.active ? "default" : "destructive"} className="gap-1">
                    {s.active ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                    {s.active ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestart(s.service)}
                    disabled={restartService === s.service}
                  >
                    {restartService === s.service ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
