"use client";

import { useQuery } from "@tanstack/react-query";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@HAForge/ui/components/skeleton";
import { Database, HardDrive } from "lucide-react";

import { trpc } from "@/utils/trpc";
import ClusterSetupWizard from "./wizard";
import ClusterOverview from "./overview/page";
import ClusterBackup from "./backup/page";

export default function ClusterDetailRouter({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const cluster = useQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get("tab") as "overview" | "backup") || "overview";

  const setTab = (tab: "overview" | "backup") => {
    router.replace(`/dashboard/clusters/${clusterId}?tab=${tab}`);
  };

  if (!cluster.data) {
    if (cluster.isError) {
      return (
        <div className="p-6">
          <p className="text-muted-foreground">Failed to load cluster. It may not exist or you don't have access.</p>
        </div>
      );
    }
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const isDraft = cluster.data.status === "draft";

  if (!isDraft) {
    return (
      <div>
        <div className="border-b px-6">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("overview")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "overview"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Database className="size-4" />
              Overview
            </button>
            <button
              onClick={() => setTab("backup")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "backup"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <HardDrive className="size-4" />
              Backup
            </button>
          </div>
        </div>
        {activeTab === "overview" && <ClusterOverview params={params} />}
        {activeTab === "backup" && <ClusterBackup params={params} />}
      </div>
    );
  }

  return <ClusterSetupWizard params={params} />;
}
