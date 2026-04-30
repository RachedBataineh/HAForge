"use client";

import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@HAForge/ui/components/card";
import { Input } from "@HAForge/ui/components/input";
import { Label } from "@HAForge/ui/components/label";
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

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
  const hasHetznerToken = p?.hasHetznerToken ?? false;
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

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
          {hasHetznerToken && !token && (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="size-3.5" />
              Token saved — Hetzner integration is active
            </div>
          )}
          {hasHetznerToken && (
            <p className="text-xs text-muted-foreground">Enter a new token to replace the existing one.</p>
          )}
          <div className="flex justify-end">
            <Button onClick={() => updateToken.mutate()} disabled={updateToken.isPending}>
              {updateToken.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Save Token
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
