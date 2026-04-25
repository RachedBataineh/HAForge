"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
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
import { HardDrive, Trash2, Play, RotateCcw, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Settings } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@HAForge/ui/components/switch";
import { trpc, trpcClient } from "@/utils/trpc";
import Link from "next/link";

const CRON_PRESETS = [
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Daily at 2 AM", value: "0 2 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Custom", value: "" },
];

function BackupLogViewer({ logData }: { logData: { isLoading: boolean; data: string | null | undefined } }) {
  if (logData.isLoading) return <Skeleton className="h-32 w-full" />;
  return (
    <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap">
      {logData.data || "No log data"}
    </pre>
  );
}

export default function ClusterBackup({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);

  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const s3Configured = !!(profile.data?.s3Endpoint && profile.data?.s3AccessKey);

  const config = useQuery(trpc.backup.getConfig.queryOptions({ clusterId }));
  const backups = useQuery(trpc.backup.listBackups.queryOptions({ clusterId }, { enabled: !!config.data && s3Configured }));
  const backupLog = useQuery(trpc.backup.getBackupLog.queryOptions({ clusterId }, { enabled: !!config.data }));

  const [bucket, setBucket] = useState("");
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
      setBucket(config.data.s3Bucket);
      setCronSchedule(config.data.cronSchedule);
      setRetention(config.data.retentionCount);
      setEnabled(!!config.data.enabled);
      setConfigured(true);
      const preset = CRON_PRESETS.find((p) => p.value === config.data!.cronSchedule);
      setCronPreset(preset ? preset.label : "Custom");
    }
  }, [config.data]);

  const testConnection = useMutation({
    mutationFn: async () => {
      return trpcClient.backup.testConnection.mutate({ clusterId, bucket });
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
        clusterId, s3Bucket: bucket,
        cronSchedule, retentionCount: retention, enabled,
      });
    },
    onSuccess: () => {
      toast.success("Backup configuration saved");
      config.refetch();
      backups.refetch();
      backupLog.refetch();
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
      setBucket("");
      setEnabled(false);
      config.refetch();
      backups.refetch();
      backupLog.refetch();
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
        backups.refetch();
        backupLog.refetch();
      } else {
        toast.error("Backup failed: " + (data.output || "Unknown error"));
        backupLog.refetch();
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
      backups.refetch();
      backupLog.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteBackup = useMutation({
    mutationFn: async (filename: string) => {
      return trpcClient.backup.deleteBackup.mutate({ clusterId, filename });
    },
    onSuccess: () => {
      toast.success("Backup deleted");
      backups.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  // S3 not configured in Settings — show banner
  if (!profile.isLoading && !s3Configured) {
    return (
      <div className="p-6">
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <AlertTriangle className="size-5" />
              S3 Storage Not Configured
            </CardTitle>
            <CardDescription>
              Configure your S3 storage credentials in Settings before setting up backups. All clusters share the same S3 credentials, but each cluster uses its own bucket.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/settings">
              <Button variant="outline" className="gap-2">
                <Settings className="size-4" />
                Go to Settings
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 gap-6">
      {/* Bucket Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="size-5" />
            S3 Bucket
          </CardTitle>
          <CardDescription>
            Each cluster uses its own S3 bucket for backups. Your S3 credentials are configured in{" "}
            <Link href="/dashboard/settings" className="text-primary underline underline-offset-2 hover:text-primary/80">
              Settings
            </Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Bucket Name</Label>
            <Input
              className="mt-1.5"
              placeholder="my-postgresql-backups"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => testConnection.mutate()}
              disabled={testConnection.isPending || !bucket}
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
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Schedule & Retention</CardTitle>
          <CardDescription>Configure automatic backup schedule and retention policy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Label>{enabled ? "Automatic backups enabled" : "Automatic backups disabled"}</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="grid gap-4 max-w-sm">
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
              disabled={saveConfig.isPending || !bucket}
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
      </div>

      {/* Backup History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Backup History</CardTitle>
            <CardDescription>Backups stored in your S3 bucket</CardDescription>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => backups.refetch()}>
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
            <Button variant="ghost" size="icon-sm" onClick={() => backupLog.refetch()}>
              <RefreshCw className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <BackupLogViewer logData={backupLog} />
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
