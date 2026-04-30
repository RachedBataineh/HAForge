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
import { useSearchParams, useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { trpc, trpcClient } from "@/utils/trpc";

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
  skipped: "outline",
};

const PHASE_LABELS: Record<string, string> = {
  hardening: "Phase 0: System Hardening",
  postgres: "Phase 1: PostgreSQL Cluster",
  haproxy: "Phase 2: HAProxy Load Balancer",
  monitoring: "Phase 3: Monitoring (Node Exporter)",
};

const ROLE_LABELS: Record<string, string> = {
  postgresql_1: "PG Node 1 (Primary)",
  postgresql_2: "PG Node 2 (Replica)",
  postgresql_3: "PG Node 3 (Replica)",
  haproxy_1: "HAProxy 1 (Master)",
  haproxy_2: "HAProxy 2 (Backup)",
  haproxy_3: "HAProxy 3 (Backup)",
};

function TerminalPanel({
  title,
  output,
  isRunning,
  exitCode,
}: {
  title: string;
  output: string;
  isRunning: boolean;
  exitCode: number | null;
}) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="rounded-lg border bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <span className="text-xs font-mono text-zinc-400">{title}</span>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
          {!isRunning && exitCode === 0 && (
            <span className="text-xs text-green-400">DONE</span>
          )}
          {!isRunning && exitCode !== null && exitCode !== 0 && (
            <span className="text-xs text-red-400">EXIT {exitCode}</span>
          )}
          {!isRunning && exitCode === null && output === "" && (
            <span className="text-xs text-zinc-500">Waiting...</span>
          )}
        </div>
      </div>
      <pre
        ref={scrollRef}
        className="p-3 text-xs font-mono text-green-400 overflow-auto max-h-80 min-h-[120px] whitespace-pre-wrap"
      >
        {output || (isRunning ? "Connecting..." : "Waiting to start...")}
        {isRunning && <span className="animate-pulse">_</span>}
      </pre>
    </div>
  );
}

function FullLogEntry({ server }: { server: any }) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [server.output]);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 mb-1.5">
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-900/50 border-b border-zinc-800">
        <span className="text-[10px] font-mono text-zinc-500">
          {server.serverIp} ({ROLE_LABELS[server.role] || server.role})
        </span>
        <div className="flex items-center gap-2">
          {server.isRunning && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <span className="inline-block w-1 h-1 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          )}
          {!server.isRunning && server.exitCode === 0 && (
            <span className="text-[10px] text-green-500">exit 0</span>
          )}
          {!server.isRunning && server.exitCode !== null && server.exitCode !== 0 && (
            <span className="text-[10px] text-red-400">exit {server.exitCode}</span>
          )}
        </div>
      </div>
      <pre
        ref={scrollRef}
        className="p-2 text-[11px] font-mono text-zinc-300 overflow-auto max-h-40 whitespace-pre-wrap"
      >
        {server.output || " "}
      </pre>
    </div>
  );
}

export default function DeployPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = React.use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const executionId = searchParams.get("executionId") || "";

  // Poll execution progress every 3s
  const execution = useQuery(
    trpc.execution.getProgress.queryOptions(
      { executionId },
      { refetchInterval: executionId ? 3000 : false },
    ),
  );

  // Poll live output every 500ms for real-time streaming (keep polling on failure so logs stay visible)
  const liveOutput = useQuery(
    trpc.execution.getLiveOutput.queryOptions(
      { executionId },
      { refetchInterval: executionId ? 500 : false },
    ),
  );

  const steps = execution.data?.steps || [];
  const completedSteps = steps.filter((s: any) => s.status === "completed").length;
  const totalSteps = steps.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const isRunning = execution.data?.status === "running";
  const currentStepName = execution.data?.currentStep;

  // Find the currently running step
  const runningStep = steps.find((s: any) => s.status === "running");
  const failedStep = steps.find((s: any) => s.status === "failed");

  // Get live terminals for the active step
  const activeLiveStep = liveOutput.data?.steps?.find(
    (s: any) => runningStep && s.stepId === runningStep.id,
  );

  // Group steps by phase for the sidebar
  const phaseGroups: { phase: string; steps: any[] }[] = [];
  for (const step of steps) {
    const last = phaseGroups[phaseGroups.length - 1];
    if (last && last.phase === step.phase) {
      last.steps.push(step);
    } else {
      phaseGroups.push({ phase: step.phase, steps: [step] });
    }
  }

  const cancelExecution = async () => {
    await trpcClient.execution.cancel.mutate({ executionId });
  };

  if (!executionId) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8 text-center">
        <p className="text-muted-foreground">No execution ID provided.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push(`/dashboard/clusters/${clusterId}`)}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-3xl font-bold">Cluster Deployment</h1>
        </div>
        <Badge variant={STATUS_COLORS[execution.data?.status || "running"]} className="text-sm px-3 py-1">
          {execution.data?.status || "running"}
        </Badge>
      </div>
      <p className="text-muted-foreground mb-6">
        {isRunning && currentStepName
          ? `Currently: ${currentStepName}`
          : execution.data?.status === "completed"
            ? "All steps completed successfully"
            : execution.data?.status === "failed"
              ? `Failed at: ${failedStep?.stepName || "unknown step"}`
              : "Starting..."}
      </p>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-medium">{progressPercent}% complete</span>
          <span className="text-muted-foreground">{completedSteps} of {totalSteps} steps</span>
        </div>
        <Progress value={progressPercent} className="h-3" />
      </div>

      {/* Live Terminal Panels */}
      {runningStep && activeLiveStep && activeLiveStep.servers.length > 0 && (
        <Card className="mb-6 border-primary/30">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
              {runningStep.stepName}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {runningStep.targetRole.replace("all_pg", "Running on 3 PostgreSQL nodes").replace("all_ha", "Running on 3 HAProxy nodes")}
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className={`grid gap-3 ${
              activeLiveStep.servers.length === 1 ? "grid-cols-1" :
              activeLiveStep.servers.length === 2 ? "grid-cols-2" :
              "grid-cols-1 lg:grid-cols-3"
            }`}>
              {activeLiveStep.servers.map((server: any) => (
                <TerminalPanel
                  key={server.serverId}
                  title={`${server.serverIp} - ${ROLE_LABELS[server.role] || server.role}`}
                  output={server.output}
                  isRunning={server.isRunning}
                  exitCode={server.exitCode}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* If step is running but no live output yet */}
      {runningStep && (!activeLiveStep || activeLiveStep.servers.length === 0) && (
        <Card className="mb-6 border-primary/30">
          <CardContent className="py-6 text-center">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span>Preparing: {runningStep.stepName}...</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step list by phase */}
      <div className="space-y-4">
        {phaseGroups.map((group) => {
          const phaseCompleted = group.steps.every((s) => s.status === "completed");
          const phaseFailed = group.steps.some((s) => s.status === "failed");
          const phaseRunning = group.steps.some((s) => s.status === "running");

          return (
            <Card key={group.phase} className={phaseRunning ? "border-primary/30" : ""}>
              <CardHeader className="p-3 pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    {PHASE_LABELS[group.phase] || group.phase}
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs">
                    {phaseCompleted && <span className="text-green-600">Done</span>}
                    {phaseFailed && <span className="text-red-500">Failed</span>}
                    {phaseRunning && (
                      <span className="flex items-center gap-1 text-primary">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        In Progress
                      </span>
                    )}
                    {!phaseCompleted && !phaseFailed && !phaseRunning && (
                      <span className="text-muted-foreground">Pending</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                <div className="space-y-0.5">
                  {group.steps.map((step: any) => (
                    <div
                      key={step.id}
                      className={`flex items-center gap-2 px-2 py-1 rounded text-sm ${
                        step.status === "running" ? "bg-primary/5 font-medium" :
                        step.status === "completed" ? "text-muted-foreground" :
                        step.status === "failed" ? "text-red-500" :
                        "text-muted-foreground/60"
                      }`}
                    >
                      <span className="w-4 text-center text-xs">
                        {step.status === "completed" ? "\u2713" :
                         step.status === "failed" ? "\u2717" :
                         step.status === "running" ? "\u25B6" :
                         "\u25CB"}
                      </span>
                      <span>{step.stepName}</span>
                      {step.status === "running" && (
                        <span className="ml-auto text-xs text-primary animate-pulse">running</span>
                      )}
                      {step.status === "failed" && step.errorMessage && (
                        <span className="ml-auto text-xs truncate max-w-48">{step.errorMessage}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Full Deployment Log - persists all output from beginning to end */}
      <Card className="mt-6">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Full Deployment Log</CardTitle>
          <p className="text-xs text-muted-foreground">All commands and output from every step, in order</p>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {(!liveOutput.data?.steps || liveOutput.data.steps.length === 0) && (
            <p className="text-xs text-muted-foreground py-2">Waiting for first step...</p>
          )}
          <div className="space-y-3">
            {liveOutput.data?.steps?.map((step: any, stepIdx: number) => {
              const stepInfo = steps.find((s: any) => s.id === step.stepId);
              const stepStatus = stepInfo?.status || "running";
              const anyRunning = step.servers.some((srv: any) => srv.isRunning);

              return (
                <div key={step.stepId}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium">
                      {stepIdx + 1}. {step.stepName}
                    </span>
                    {stepStatus === "completed" && <span className="text-xs text-green-500">OK</span>}
                    {stepStatus === "failed" && <span className="text-xs text-red-500">FAILED</span>}
                    {anyRunning && (
                      <span className="text-xs text-primary flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        LIVE
                      </span>
                    )}
                  </div>
                  {stepInfo?.resolvedCommand && (
                    <pre className="mb-1.5 p-2 rounded bg-blue-950/50 border border-blue-900/30 text-[11px] font-mono text-blue-300 whitespace-pre-wrap">
                      {"$ " + stepInfo.resolvedCommand.split("\n").filter((l: string) => l !== "set -e" && !l.startsWith("export ")).join("\n$ ")}
                    </pre>
                  )}
                  {step.servers.map((server: any) => (
                    <FullLogEntry
                      key={server.serverId}
                      server={server}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      {isRunning && (
        <div className="mt-6 flex justify-end">
          <Button variant="destructive" onClick={cancelExecution}>
            {execution.data?.executionType === "patch" ? "Cancel Patch" : "Cancel Deployment"}
          </Button>
        </div>
      )}

      {execution.data?.status === "failed" && execution.data?.executionType !== "patch" && (
        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={async () => {
              const data = await trpcClient.execution.retryStep.mutate({
                executionId,
                stepId: failedStep?.id || "",
              });
              if (data.executionId) {
                window.location.href = `/dashboard/clusters/${clusterId}/deploy?executionId=${data.executionId}`;
              }
            }}
          >
            Retry Deployment
          </Button>
        </div>
      )}

      {execution.data?.status === "failed" && execution.data?.executionType === "patch" && (
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push(`/dashboard/clusters/${clusterId}/overview`)}>
            Back to Cluster
          </Button>
        </div>
      )}

      {execution.data?.status === "completed" && execution.data?.executionType !== "patch" && (
        <Card className="mt-6 border-green-500/30 bg-green-500/5">
          <CardContent className="py-6 text-center">
            <div className="text-2xl mb-2">&#10003;</div>
            <h3 className="text-lg font-semibold">Deployment Complete!</h3>
            <p className="text-muted-foreground mt-1">
              Your PostgreSQL HA cluster is now running. Connect to your database via the Floating IP on port 5432.
            </p>
          </CardContent>
        </Card>
      )}

      {execution.data?.status === "completed" && execution.data?.executionType === "patch" && (
        <Card className="mt-6 border-green-500/30 bg-green-500/5">
          <CardContent className="py-6 text-center">
            <div className="text-2xl mb-2">&#10003;</div>
            <h3 className="text-lg font-semibold">Patch Applied Successfully!</h3>
            <p className="text-muted-foreground mt-1">
              Your cluster has been updated. All nodes are running the latest version.
            </p>
            <Button className="mt-4" onClick={() => router.push(`/dashboard/clusters/${clusterId}/overview`)}>
              Back to Cluster
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
