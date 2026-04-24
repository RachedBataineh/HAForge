"use client";

import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Skeleton } from "@HAForge/ui/components/skeleton";

import { trpc } from "@/utils/trpc";
import ClusterSetupWizard from "./wizard";
import ClusterOverview from "./overview/page";

export default function ClusterDetailRouter({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const cluster = useQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));

  if (!cluster.data) {
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
    return <ClusterOverview params={params} />;
  }

  return <ClusterSetupWizard params={params} />;
}
