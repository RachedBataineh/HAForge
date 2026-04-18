"use client";

import { Badge } from "@HAForge/ui/components/badge";
import { Button } from "@HAForge/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@HAForge/ui/components/card";
import { Progress } from "@HAForge/ui/components/progress";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { trpc } from "@/utils/trpc";

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
  skipped: "outline",
};

const PHASE_LABELS: Record<string, string> = {
  postgres: "PostgreSQL Cluster",
  haproxy: "HAProxy Load Balancer",
  done: "Complete",
};

export default function DeployPage({ params }: { params: Promise<{ id: string }> }) {
  const [clusterId, setClusterId] = useState("");
  params.then((p) => setClusterId(p.id));

  const searchParams = useSearchParams();
  const executionId = searchParams.get("executionId") || "";

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const execution = useQuery(
    trpc.execution.getProgress.queryOptions(
      { executionId },
      { refetchInterval: executionId ? 2000 : false },
    ),
  );

  const logs = useQuery(
    trpc.execution.getLogs.queryOptions(
      { stepId: selectedStepId || "" },
      { enabled: !!selectedStepId, refetchInterval: selectedStepId ? 3000 : false },
    ),
  );

  const steps = execution.data?.steps || [];
  const completedSteps = steps.filter((s: any) => s.status === "completed").length;
  const totalSteps = steps.length;
  const progressPercent = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  const cancelExecution = async () => {
    await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/trpc/execution.cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ json: { executionId } }),
    });
  };

  if (!clusterId || !executionId) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Cluster Deployment</h1>
          <p className="text-muted-foreground mt-1">
            {execution.data?.currentPhase
              ? PHASE_LABELS[execution.data.currentPhase] || execution.data.currentPhase
              : "Starting..."}
          </p>
        </div>
        <Badge variant={STATUS_COLORS[execution.data?.status || "running"]}>
          {execution.data?.status || "running"}
        </Badge>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span>Progress</span>
          <span>{completedSteps}/{totalSteps} steps</span>
        </div>
        <Progress value={progressPercent} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Steps list */}
        <div className="lg:col-span-1 space-y-2">
          {steps.map((step: any) => (
            <Card
              key={step.id}
              className={`cursor-pointer transition-colors ${
                selectedStepId === step.id ? "border-primary" : ""
              }`}
              onClick={() => setSelectedStepId(step.id)}
            >
              <CardHeader className="p-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    <span className="text-muted-foreground mr-1">{step.stepNumber}.</span>
                    {step.stepName}
                  </CardTitle>
                  <Badge variant={STATUS_COLORS[step.status]} className="text-xs">
                    {step.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {step.phase} - {step.targetRole}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* Log viewer */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="p-3">
              <CardTitle className="text-sm">
                {selectedStepId ? "Command Output" : "Select a step to view logs"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              {selectedStepId && (
                <div className="space-y-4">
                  {logs.data?.map((log: any) => (
                    <div key={log.id}>
                      <div className="text-xs text-muted-foreground mb-1">
                        Server: {log.serverId?.slice(0, 8)}... | Exit Code: {log.exitCode}
                      </div>
                      {log.stdout && (
                        <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                          {log.stdout}
                        </pre>
                      )}
                      {log.stderr && (
                        <pre className="bg-destructive/10 p-3 rounded-md text-xs overflow-auto max-h-48 whitespace-pre-wrap mt-2 text-destructive">
                          {log.stderr}
                        </pre>
                      )}
                    </div>
                  ))}
                  {(!logs.data || logs.data.length === 0) && (
                    <p className="text-sm text-muted-foreground">Waiting for output...</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {execution.data?.status === "running" && (
        <div className="mt-6 flex justify-end">
          <Button variant="destructive" onClick={cancelExecution}>
            Cancel Deployment
          </Button>
        </div>
      )}

      {execution.data?.status === "failed" && (
        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={async () => {
              const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/trpc/execution.retryStep`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ json: { executionId, stepId: steps.find((s: any) => s.status === "failed")?.id || "" } }),
              });
              const data = await res.json();
              // Navigate to new execution
              if (data.result?.data?.json?.executionId) {
                window.location.href = `/dashboard/clusters/${clusterId}/deploy?executionId=${data.result.data.json.executionId}`;
              }
            }}
          >
            Retry Failed Step
          </Button>
        </div>
      )}

      {execution.data?.status === "completed" && (
        <div className="mt-6">
          <Card className="bg-green-500/10 border-green-500/20">
            <CardContent className="py-6 text-center">
              <h3 className="text-lg font-semibold text-green-600">Deployment Complete!</h3>
              <p className="text-muted-foreground mt-1">
                Your PostgreSQL HA cluster is now running. Connect via Floating IP: <code className="font-mono">{execution.data?.clusterId}</code>
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
