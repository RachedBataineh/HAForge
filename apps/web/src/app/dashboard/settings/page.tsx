"use client";

import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { Separator } from "@HAForge/ui/components/separator";
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle2, HardDrive } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@HAForge/ui/components/select";

import { trpc, trpcClient } from "@/utils/trpc";

const S3_PRESETS = [
  { name: "AWS S3", endpoint: "https://s3.amazonaws.com", region: "us-east-1" },
  { name: "Wasabi US East", endpoint: "https://s3.wasabisys.com", region: "us-east-1" },
  { name: "Wasabi EU Central", endpoint: "https://s3.eu-central-1.wasabisys.com", region: "eu-central-1" },
  { name: "MinIO / Custom", endpoint: "", region: "" },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const profile = useQuery(trpc.settings.getProfile.queryOptions());
  const p = profile.data;

  // Profile
  const [name, setName] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  if (p && !profileLoaded) {
    setName(p.name);
    setProfileLoaded(true);
  }

  // Hetzner API Token
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenLoaded, setTokenLoaded] = useState(false);
  if (p && !tokenLoaded) {
    setToken(p.hetznerApiToken);
    setTokenLoaded(true);
  }

  // S3 Storage
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [showS3Secret, setShowS3Secret] = useState(false);
  const [s3Loaded, setS3Loaded] = useState(false);
  if (p && !s3Loaded) {
    setS3Endpoint(p.s3Endpoint || "https://s3.amazonaws.com");
    setS3Region(p.s3Region || "us-east-1");
    setS3AccessKey(p.s3AccessKey || "");
    setS3SecretKey(p.s3SecretKey || "");
    setS3Loaded(true);
  }

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const updateProfile = useMutation({
    mutationFn: async () => {
      return await trpcClient.settings.updateProfile.mutate({ name });
    },
    onSuccess: () => {
      toast.success("Profile updated");
      queryClient.invalidateQueries(trpc.settings.getProfile.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  const updateToken = useMutation({
    mutationFn: async () => {
      return await trpcClient.settings.updateHetznerToken.mutate({ hetznerApiToken: token });
    },
    onSuccess: () => {
      toast.success("Hetzner API token saved");
      queryClient.invalidateQueries(trpc.settings.getProfile.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  const updateS3 = useMutation({
    mutationFn: async () => {
      return await trpcClient.settings.updateS3Config.mutate({
        s3Endpoint,
        s3Region,
        s3AccessKey,
        s3SecretKey,
      });
    },
    onSuccess: () => {
      toast.success("S3 storage configuration saved");
      queryClient.invalidateQueries(trpc.settings.getProfile.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      return await trpcClient.settings.changePassword.mutate({ currentPassword, newPassword });
    },
    onSuccess: () => {
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(err.message),
  });

  const s3Configured = p?.s3Endpoint && p?.s3AccessKey;

  if (profile.isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and integrations</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={p?.email || ""} disabled className="bg-muted" />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => updateProfile.mutate()} disabled={!name.trim() || updateProfile.isPending}>
              {updateProfile.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Save Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hetzner API Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Hetzner API
          </CardTitle>
          <CardDescription>
            Save your Hetzner Cloud API token to enable server management, SSH key syncing, and cluster deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>API Token</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="hcloud_xxxxxxxxxxxxxxxxxxxx"
                  className="pr-10"
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          </div>
          {token && (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="size-3.5" />
              Token saved — Hetzner integration is active
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => updateToken.mutate()} disabled={updateToken.isPending}>
              {updateToken.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Save Token
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* S3 Storage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="size-5" />
            S3 Storage
          </CardTitle>
          <CardDescription>
            Configure your S3-compatible storage credentials. Used by all clusters for backups — each cluster gets its own bucket.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <Label>Provider Preset</Label>
            <Select value={s3Endpoint} onValueChange={(val) => {
              const preset = S3_PRESETS.find((p) => p.endpoint === val);
              if (preset) { setS3Endpoint(preset.endpoint); setS3Region(preset.region); }
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
            <div className="grid gap-2">
              <Label>Endpoint URL</Label>
              <Input placeholder="https://s3.amazonaws.com" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Region</Label>
              <Input placeholder="us-east-1" value={s3Region} onChange={(e) => setS3Region(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Access Key ID</Label>
              <Input placeholder="AKIA..." value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Secret Access Key</Label>
              <div className="relative">
                <Input
                  type={showS3Secret ? "text" : "password"}
                  placeholder="••••••••"
                  value={s3SecretKey}
                  onChange={(e) => setS3SecretKey(e.target.value)}
                  className="pr-10"
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowS3Secret(!showS3Secret)}
                >
                  {showS3Secret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          </div>
          {s3Configured && (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="size-3.5" />
              S3 credentials saved — backups are ready to configure per-cluster
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => updateS3.mutate()} disabled={updateS3.isPending || !s3Endpoint || !s3AccessKey}>
              {updateS3.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Save S3 Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Current Password</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </div>
          <div className="grid gap-2">
            <Label>New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </div>
          <div className="grid gap-2">
            <Label>Confirm New Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => changePassword.mutate()}
              disabled={!currentPassword || !newPassword || newPassword !== confirmPassword || newPassword.length < 8 || changePassword.isPending}
            >
              {changePassword.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
