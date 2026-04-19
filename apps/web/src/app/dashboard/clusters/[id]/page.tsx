"use client";

import { useQuery } from "@tanstack/react-query";
import React from "react";

import { trpc } from "@/utils/trpc";
import ClusterSetupWizard from "./wizard";
import ClusterOverview from "./overview/page";

export default function ClusterDetailRouter({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const cluster = useQuery(trpc.cluster.getById.queryOptions({ id: clusterId }));

  if (!cluster.data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const hasServers = cluster.data.servers && cluster.data.servers.length > 0;

  if (hasServers) {
    return <ClusterOverview params={params} />;
  }

  return <ClusterSetupWizard params={params} />;
}
