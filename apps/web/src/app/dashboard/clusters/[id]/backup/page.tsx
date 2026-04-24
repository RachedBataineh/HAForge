"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { Badge } from "@HAForge/ui/components/badge";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@HAForge/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@HAForge/ui/components/dialog";
import { HardDrive, Plus, Trash2, Play, RotateCcw, RefreshCw, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc, trpcClient } from "@/utils/trpc";

const S3_PRESETS = [
  { name: "AWS S3", endpoint: "https://s3.amazonaws.com", region: "us-east-1" },
  { name: "Wasabi US East", endpoint: "https://s3.wasabisys.com", region: "us-east-1" },
  { name: "Wasabi EU Central", endpoint: "https://s3.eu-central-1.wasabisys.com", region: "eu-central-1" },
  { name: "MinIO (Custom)", endpoint: "", region: "" },
];

const CRON_PRESETS = [
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Daily at 2 AM", value: "0 2 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Custom", value: "" },
];

function BackupLogViewer({ clusterId }: { clusterId: string }) {
  const log = useQuery(trpc.backup.getBackupLog.queryOptions({ clusterId }));
  if (log.isLoading) return <Skeleton className="h-32 w-full" />;
  return (
    <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap">
      {log.data || "No log data"}
    </pre>
  );
}

export default function ClusterBackup({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const config = useQuery(trpc.backup.getConfig.queryOptions({ clusterId }));
  const backups = useQuery(trpc.backup.listBackups.queryOptions({ clusterId }, { enabled: !!config.data }));

  const [endpoint, setEndpoint] = useState("https://s3.amazonaws.com");
  const [region, setRegion] = useState("us-east-1");
  const [bucket, setBucket] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [cronSchedule, setCronSchedule] = useState("0 2 * * *");
  const [cronPreset, setCronPreset] = useState("Daily at 2 AM");
  const [retention, setRetention] = useState(7);
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output: string } | null>(null);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState("");
  const [restoreDb, setRestoreDb] = useState("postgres");
  const [restoreConfirm, setRestoreConfirm] = useState("");

  // Load existing config
  React.useEffect(() => {
    if (config.data) {
      setEndpoint(config.data.s3Endpoint);
      setRegion(config.data.s3Region);
      setBucket(config.data.s3Bucket);
      setAccessKey(config.data.s3AccessKey);
      setSecretKey(config.data.s3SecretKey);
      setPathPrefix(config.data.s3PathPrefix || "");
      setCronSchedule(config.data.cronSchedule);
      setRetention(config.data.retentionCount);
      setEnabled(!!config.data.enabled);
      setConfigured(true);
      // Match preset
      const preset = CRON_PRESETS.find((p) => p.value === config.data!.cronSchedule);
      setCronPreset(preset ? preset.label : "Custom");
    }
  }, [config.data]);

  const testConnection = useMutation({
    mutationFn: async () => {
      return trpcClient.backup.testConnection.mutate({
        clusterId, endpoint, region, bucket, accessKey, secretKey,
      });
    },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) toast.success("Connection successful");
      else toast.error("Connection failed");
    },
    onError: (err) => {
      setTestResult({ success: false, output: err.message });
      toast.error(err.message);
    },
  });

  const saveConfig = useMutation({
    mutationFn: async () => {
      return trpcClient.backup.saveConfig.mutate({
        clusterId, s3Endpoint: endpoint, s3Region: region, s3Bucket: bucket,
        s3AccessKey: accessKey, s3SecretKey: secretKey,
        s3PathPrefix: pathPrefix || undefined,
        cronSchedule, retentionCount: retention, enabled,
      });
    },
    onSuccess: () => {
      toast.success("Backup configuration saved");
      queryClient.invalidateQueries({ queryKey: ["backup"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const removeConfig = useMutation({
    mutationFn: async () => {
      return trpcClient.backup.removeConfig.mutate({ clusterId });
    },
    onSuccess: () => {
      toast.success("Backup configuration removed");
      setConfigured(false);
      setBucket(""); setAccessKey(""); setSecretKey(""); setPathPrefix("");
      setEnabled(false);
      queryClient.invalidateQueries({ queryKey: ["backup"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const triggerBackup = useMutation({
    mutationFn: async () => {
      return trpcClient.backup.triggerBackup.mutate({ clusterId });
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Backup completed successfully");
        queryClient.invalidateQueries({ queryKey: ["backup", "listBackups"] });
      } else {
        toast.error("Backup failed: " + (data.output || "Unknown error"));
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const restoreBackup = useMutation({
    mutationFn: async () => {
      return trpcClient.backup.restoreBackup.mutate({ clusterId, filename: restoreFile, targetDb: restoreDb });
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Restore completed");
      } else {
        toast.error("Restore failed: " + (data.output || "Unknown error"));
      }
      setRestoreOpen(false);
      setRestoreConfirm("");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteBackup = useMutation({
    mutationFn: async (filename: string) => {
      return trpcClient.backup.deleteBackup.mutate({ clusterId, filename });
    },
    onSuccess: () => {
      toast.success("Backup deleted");
      queryClient.invalidateQueries({ queryKey: ["backup", "listBackups"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="p-6 space-y-6">
      {/* S3 Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="size-5" />
            S3 Storage Configuration
          </CardTitle>
          <CardDescription>
            Configure an S3-compatible storage to store your PostgreSQL backups
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Provider Preset</Label>
            <Select value={endpoint} onValueChange={(val) => {
              const preset = S3_PRESETS.find((p) => p.endpoint === val);
              if (preset) { setEndpoint(preset.endpoint); setRegion(preset.region); }
            }}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select provider" /></SelectTrigger>
              <SelectContent>
                {S3_PRESETS.map((p) => (
                  <SelectItem key={p.name} value={p.endpoint || "custom"}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Endpoint URL</Label>
              <Input className="mt-1.5" placeholder="https://s3.amazonaws.com" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Region</Label>
              <Input className="mt-1.5" placeholder="us-east-1" value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Bucket Name</Label>
            <Input className="mt-1.5" placeholder="my-postgresql-backups" value={bucket} onChange={(e) => setBucket(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Access Key ID</Label>
              <Input className="mt-1.5" placeholder="AKIA..." value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Secret Access Key</Label>
              <Input className="mt-1.5" type="password" placeholder="••••••••" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Path Prefix (optional)</Label>
            <Input className="mt-1.5" placeholder="backups/cluster-1/" value={pathPrefix} onChange={(e) => setPathPrefix(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => testConnection.mutate()}
              disabled={testConnection.isPending || !bucket || !accessKey || !secretKey}
            >
              {testConnection.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <CheckCircle2 className="size-4 mr-2" />}
              Test Connection
            </Button>
            {testResult && (
              <div className={`text-sm ${testResult.success ? "text-green-600" : "text-destructive"}`}>
                <p>{testResult.success ? "Connection successful" : "Connection failed"}</p>
                {!testResult.success && testResult.output && (
                  <p className="text-xs font-mono mt-1 max-w-lg break-all">{testResult.output}</p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={() => saveConfig.mutate()}
              disabled={saveConfig.isPending || !bucket || !accessKey}
            >
              {saveConfig.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <HardDrive className="size-4 mr-2" />}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Schedule & Retention</CardTitle>
          <CardDescription>Configure automatic backup schedule and retention policy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label>Automatic Backups</Label>
              <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
            </div>
            <Button variant={enabled ? "destructive" : "default"} size="sm" onClick={() => setEnabled(!enabled)}>
              {enabled ? "Disable" : "Enable"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Schedule</Label>
              <Select value={cronPreset} onValueChange={(val) => {
                if (val) setCronPreset(val);
                const preset = CRON_PRESETS.find((p) => p.label === val);
                if (preset && preset.value) setCronSchedule(preset.value);
              }}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cronPreset === "Custom" && (
              <div>
                <Label className="text-xs">Cron Expression</Label>
                <Input className="mt-1.5" placeholder="0 2 * * *" value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} />
              </div>
            )}
            <div>
              <Label className="text-xs">Retention Count</Label>
              <Input className="mt-1.5" type="number" min={1} max={100} value={retention} onChange={(e) => setRetention(parseInt(e.target.value) || 7)} />
              <p className="text-xs text-muted-foreground mt-1">Keep last {retention} backups</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => saveConfig.mutate()}
              disabled={saveConfig.isPending || !bucket || !accessKey}
            >
              {saveConfig.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <HardDrive className="size-4 mr-2" />}
              Save & Deploy
            </Button>
            <Button
              variant="outline"
              onClick={() => triggerBackup.mutate()}
              disabled={triggerBackup.isPending || !configured}
            >
              {triggerBackup.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Play className="size-4 mr-2" />}
              Backup Now
            </Button>
            {configured && (
              <Button variant="destructive" size="sm" onClick={() => removeConfig.mutate()} disabled={removeConfig.isPending}>
                <Trash2 className="size-4 mr-2" />
                Remove Config
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Backup History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Backup History</CardTitle>
            <CardDescription>Backups stored in your S3 bucket</CardDescription>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["backup", "listBackups"] })}>
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {backups.isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          )}
          {!backups.isLoading && (!backups.data || backups.data.length === 0) && (
            <p className="text-sm text-muted-foreground py-4 text-center">No backups yet. Configure and trigger a backup to get started.</p>
          )}
          {backups.data && backups.data.length > 0 && (
            <div className="border rounded-lg divide-y">
              <div className="grid grid-cols-[1fr_120px_80px_120px] gap-4 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Filename</span>
                <span>Date</span>
                <span>Size</span>
                <span className="text-right">Actions</span>
              </div>
              {backups.data.map((backup: any) => (
                <div key={backup.filename} className="grid grid-cols-[1fr_120px_80px_120px] gap-4 px-4 py-2.5 items-center text-sm">
                  <span className="font-mono text-xs truncate">{backup.filename}</span>
                  <span className="text-muted-foreground text-xs">{backup.date}</span>
                  <span className="text-muted-foreground text-xs">{formatSize(backup.size)}</span>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => { setRestoreFile(backup.filename); setRestoreOpen(true); }}
                      title="Restore this backup"
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => deleteBackup.mutate(backup.filename)}
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backup Log */}
      {configured && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Backup Log</CardTitle>
              <CardDescription>Last 50 lines from the backup log on the server</CardDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["backup", "getBackupLog"] })}>
              <RefreshCw className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <BackupLogViewer clusterId={clusterId} />
          </CardContent>
        </Card>
      )}

      {/* Restore Dialog */}
      <Dialog open={restoreOpen} onOpenChange={(open) => { setRestoreOpen(open); if (!open) setRestoreConfirm(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <RotateCcw className="size-5" />
              Restore Backup
            </DialogTitle>
            <DialogDescription>
              This will restore the database from a backup file. Existing data may be overwritten.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Backup File</Label>
              <p className="font-mono text-sm mt-1">{restoreFile}</p>
            </div>
            <div>
              <Label className="text-xs">Target Database</Label>
              <Input className="mt-1.5" value={restoreDb} onChange={(e) => setRestoreDb(e.target.value)} />
            </div>
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm">
              <p className="font-medium text-destructive">Warning</p>
              <p className="text-muted-foreground mt-1">
                Restoring to <code className="font-mono">{restoreDb}</code> will overwrite existing data in that database.
              </p>
            </div>
            <div>
              <Label className="text-xs">Type the database name to confirm</Label>
              <Input className="mt-1.5" placeholder={restoreDb} value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={restoreConfirm !== restoreDb || restoreBackup.isPending}
              onClick={() => restoreBackup.mutate()}
            >
              {restoreBackup.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <RotateCcw className="size-4 mr-2" />}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatSize(bytes: string): string {
  const b = parseInt(bytes, 10);
  if (isNaN(b)) return bytes;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
