"use client";

import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { CheckCircle2, Loader2, RotateCw, Shield } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trpcClient } from "@/utils/trpc";

export default function NetworkingTab({ server }: { server: any }) {
  const [loading, setLoading] = useState(false);
  const [ufwStatus, setUfwStatus] = useState<string | null>(null);
  const [listeningPorts, setListeningPorts] = useState<string[] | null>(null);

  const sshExec = async (command: string) => {
    return await trpcClient.cluster.sshExec.mutate({
      host: server.ipAddress,
      port: server.sshPort || 22,
      username: server.sshUser || "root",
      privateKey: server.sshPrivateKey,
      command,
    });
  };

  const fetchNetworking = async () => {
    setLoading(true);
    try {
      const data = await sshExec([
        "echo '---UFW---'",
        "sudo ufw status 2>/dev/null || echo 'UFW not installed'",
        "echo '---END---'",
        "echo '---PORTS---'",
        "ss -tlnp 2>/dev/null | tail -n +2 | awk '{print $4, $6}'",
        "echo '---END---'",
      ].join("\n"));

      const stdout = data.stdout as string;

      const ufwMatch = stdout.match(/---UFW---\s*([\s\S]*?)---END---/);
      setUfwStatus(ufwMatch ? ufwMatch[1].trim() : null);

      const portsMatch = stdout.match(/---PORTS---\s*([\s\S]*?)---END---/);
      if (portsMatch) {
        const lines = portsMatch[1].trim().split("\n").filter(Boolean);
        setListeningPorts(lines.map((l: string) => {
          const parts = l.trim().split(/\s+/);
          const addr = parts[0] || "";
          const port = addr.split(":").pop() || "";
          const process = parts.slice(1).join(" ") || "";
          return `${port} ${process}`;
        }));
      }
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Networking</h2>
          <p className="text-sm text-muted-foreground">Firewall status and listening ports</p>
        </div>
        <Button variant="outline" onClick={fetchNetworking} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <RotateCw className="size-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {!listeningPorts && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Click "Refresh" to fetch networking info from the server.
          </CardContent>
        </Card>
      )}

      {loading && !listeningPorts && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Fetching networking info...
          </CardContent>
        </Card>
      )}

      {ufwStatus !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="size-4" />
              UFW Firewall Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">{ufwStatus}</pre>
          </CardContent>
        </Card>
      )}

      {listeningPorts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Listening Ports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {listeningPorts.map((line, i) => {
                const [port, ...processParts] = line.split(" ");
                return (
                  <div key={i} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-2.5">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-3.5 text-green-500" />
                      <span className="font-mono">{port}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{processParts.join(" ")}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
