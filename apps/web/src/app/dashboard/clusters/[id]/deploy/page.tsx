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
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
} from "lucide-react";

import { trpc, trpcClient } from "@/utils/trpc";

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
  skipped: "outline",
};

const PHASE_LABELS: Record<string, string> = {
  hardening: "System Hardening",
  postgres: "PostgreSQL Cluster",
  haproxy: "HAProxy Load Balancer",
  monitoring: "Monitoring",
};

const ROLE_LABELS: Record<string, string> = {
  postgresql_1: "PG Node 1",
  postgresql_2: "PG Node 2",
  postgresql_3: "PG Node 3",
  haproxy_1: "HAProxy 1",
  haproxy_2: "HAProxy 2",
  haproxy_3: "HAProxy 3",
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
    <div className="rounded-lg border bg-zinc-950 overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
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
        className="p-3 text-xs font-mono text-green-400 overflow-auto flex-1 min-h-[200px] whitespace-pre-wrap"
      >
        {output || (isRunning ? "Connecting..." : "Waiting to start...")}
        {isRunning && <span className="animate-pulse">_</span>}
      </pre>
    </div>
  );
}

function FullLogEntry({ server, collapsed }: { server: any; collapsed: boolean }) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [server.output, collapsed]);

  if (collapsed) return null;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between px-2 py-0.5 bg-zinc-900/50 border-b border-zinc-800">
        <span className="text-[10px] font-mono text-zinc-500">
          {server.serverIp} ({ROLE_LABELS[server.role] || server.role})
        </span>
        <div className="flex items-center gap-2">
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
        className="p-1.5 text-[11px] font-mono text-zinc-400 overflow-auto max-h-32 whitespace-pre-wrap"
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

  // Track which phases are manually toggled open
  const [manualOpen, setManualOpen] = useState<Set<string>>(new Set());

  const execution = useQuery(
    trpc.execution.getProgress.queryOptions(
      { executionId },
      { refetchInterval: executionId ? 3000 : false },
    ),
  );

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

  const runningStep = steps.find((s: any) => s.status === "running");
  const failedStep = steps.find((s: any) => s.status === "failed");

  const activeLiveStep = liveOutput.data?.steps?.find(
    (s: any) => runningStep && s.stepId === runningStep.id,
  );

  // Group steps by phase
  const phaseGroups: { phase: string; steps: any[] }[] = [];
  for (const step of steps) {
    const last = phaseGroups[phaseGroups.length - 1];
    if (last && last.phase === step.phase) {
      last.steps.push(step);
    } else {
      phaseGroups.push({ phase: step.phase, steps: [step] });
    }
  }

  // Determine which phase is currently active (running or first pending)
  const activePhase = phaseGroups.find((g) =>
    g.steps.some((s) => s.status === "running" || s.status === "failed"),
  )?.phase || phaseGroups.find((g) => g.steps.some((s) => s.status === "pending"))?.phase;

  // A phase is expanded if it's the active one OR manually toggled
  const isPhaseOpen = (phase: string) => {
    const group = phaseGroups.find((g) => g.phase === phase);
    if (!group) return false;
    const phaseCompleted = group.steps.every((s) => s.status === "completed");
    if (manualOpen.has(phase)) return true;
    if (phase === activePhase) return true;
    if (phaseCompleted) return false;
    return false;
  };

  const togglePhase = (phase: string) => {
    setManualOpen((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

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

  const phaseStatus = (group: { phase: string; steps: any[] }) => {
    const completed = group.steps.every((s) => s.status === "completed");
    const failed = group.steps.some((s) => s.status === "failed");
    const running = group.steps.some((s) => s.status === "running");
    if (completed) return "completed" as const;
    if (failed) return "failed" as const;
    if (running) return "running" as const;
    return "pending" as const;
  };

  const stepIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="size-3.5 text-green-500" />;
      case "failed": return <XCircle className="size-3.5 text-red-500" />;
      case "running": return <Loader2 className="size-3.5 text-primary animate-spin" />;
      default: return <Circle className="size-3.5 text-zinc-600" />;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon-sm" onClick={() => router.push(`/dashboard/clusters/${clusterId}`)}>
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Cluster Deployment</h1>
              <p className="text-sm text-muted-foreground">
                {isRunning && currentStepName
                  ? `Currently: ${currentStepName}`
                  : execution.data?.status === "completed"
                    ? "All steps completed successfully"
                    : execution.data?.status === "failed"
                      ? `Failed at: ${failedStep?.stepName || "unknown step"}`
                      : "Starting..."}
              </p>
            </div>
          </div>
          <Badge variant={STATUS_COLORS[execution.data?.status || "running"]} className="text-sm px-3 py-1">
            {execution.data?.status || "running"}
          </Badge>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium">{progressPercent}%</span>
            <span className="text-muted-foreground">{completedSteps}/{totalSteps} steps</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: Phases & Steps */}
        <div className="w-72 shrink-0 border-r bg-muted/20 overflow-y-auto">
          <div className="p-3 space-y-1">
            {phaseGroups.map((group) => {
              const status = phaseStatus(group);
              const open = isPhaseOpen(group.phase);
              const completedInPhase = group.steps.filter((s) => s.status === "completed").length;

              return (
                <div key={group.phase} className="rounded-lg border bg-card">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => togglePhase(group.phase)}
                  >
                    {status === "completed" ? (
                      <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                    ) : status === "failed" ? (
                      <XCircle className="size-4 text-red-500 shrink-0" />
                    ) : status === "running" ? (
                      <Loader2 className="size-4 text-primary animate-spin shrink-0" />
                    ) : (
                      <Circle className="size-4 text-zinc-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {PHASE_LABELS[group.phase] || group.phase}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {completedInPhase}/{group.steps.length} steps
                      </p>
                    </div>
                    {open ? (
                      <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                  {open && (
                    <div className="border-t px-2 py-1.5 space-y-0.5">
                      {group.steps.map((step: any) => (
                        <div
                          key={step.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                            step.status === "running"
                              ? "bg-primary/10 font-medium"
                              : step.status === "failed"
                                ? "text-red-500"
                                : step.status === "completed"
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/50"
                          }`}
                        >
                          {stepIcon(step.status)}
                          <span className="truncate flex-1">{step.stepName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel: Terminals + Log */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Live Terminal Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {runningStep && activeLiveStep && activeLiveStep.servers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <h2 className="text-sm font-semibold">{runningStep.stepName}</h2>
                  <span className="text-xs text-muted-foreground">
                    {runningStep.targetRole.replace("all_pg", "3 PostgreSQL nodes").replace("all_ha", "3 HAProxy nodes")}
                  </span>
                </div>
                <div className={`grid gap-3 ${
                  activeLiveStep.servers.length === 1 ? "grid-cols-1" :
                  activeLiveStep.servers.length === 2 ? "grid-cols-2" :
                  "grid-cols-1 xl:grid-cols-3"
                }`}>
                  {activeLiveStep.servers.map((server: any) => (
                    <TerminalPanel
                      key={server.serverId}
                      title={`${server.serverIp} — ${ROLE_LABELS[server.role] || server.role}`}
                      output={server.output}
                      isRunning={server.isRunning}
                      exitCode={server.exitCode}
                    />
                  ))}
                </div>
              </div>
            )}

            {runningStep && (!activeLiveStep || activeLiveStep.servers.length === 0) && (
              <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Preparing: {runningStep.stepName}...</span>
                </div>
              </div>
            )}

            {!runningStep && execution.data?.status === "completed" && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-4xl mb-3">&#10003;</div>
                  <h3 className="text-lg font-semibold">
                    {execution.data?.executionType === "patch" ? "Patch Applied!" : "Cluster Ready!"}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {execution.data?.executionType === "patch"
                      ? "All nodes have been updated successfully."
                      : "Your high-availability PostgreSQL cluster is up and running."}
                  </p>
                  <Button className="mt-4" onClick={() => router.replace(`/dashboard/clusters/${clusterId}/overview`)}>
                    Go to Cluster
                  </Button>
                </div>
              </div>
            )}

            {!runningStep && execution.data?.status === "failed" && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <XCircle className="size-10 text-red-500 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold">Deployment Failed</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Failed at: {failedStep?.stepName || "unknown step"}
                  </p>
                  <div className="mt-4 flex gap-2 justify-center">
                    {execution.data?.executionType !== "patch" && (
                      <Button onClick={async () => {
                        const data = await trpcClient.execution.retryStep.mutate({
                          executionId,
                          stepId: failedStep?.id || "",
                        });
                        if (data.executionId) {
                          window.location.href = `/dashboard/clusters/${clusterId}/deploy?executionId=${data.executionId}`;
                        }
                      }}>
                        Retry
                      </Button>
                    )}
                    {execution.data?.executionType === "patch" && (
                      <Button variant="outline" onClick={() => router.push(`/dashboard/clusters/${clusterId}/overview`)}>
                        Back to Cluster
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!runningStep && execution.data?.status === "running" && (
              <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Starting deployment...</span>
                </div>
              </div>
            )}
          </div>

          {/* Full Deployment Log — bottom drawer */}
          <DeploymentLog
            steps={steps}
            liveSteps={liveOutput.data?.steps || []}
          />
        </div>
      </div>

      {/* Cancel button */}
      {isRunning && (
        <div className="shrink-0 border-t px-6 py-3 flex justify-end bg-background">
          <Button variant="destructive" size="sm" onClick={cancelExecution}>
            {execution.data?.executionType === "patch" ? "Cancel Patch" : "Cancel Deployment"}
          </Button>
        </div>
      )}
    </div>
  );
}

function DeploymentLog({ steps, liveSteps }: { steps: any[]; liveSteps: any[] }) {
  const [logOpen, setLogOpen] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Auto-expand running steps, collapse completed ones
  useEffect(() => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      for (const step of liveSteps) {
        const stepInfo = steps.find((s: any) => s.id === step.stepId);
        const anyRunning = step.servers.some((srv: any) => srv.isRunning);
        const stepStatus = stepInfo?.status;
        if (anyRunning) {
          next.add(step.stepId);
        } else if (stepStatus === "completed" || stepStatus === "failed") {
          // Keep failed steps expanded, collapse completed
          if (stepStatus === "completed") {
            next.delete(step.stepId);
          }
        }
      }
      return next;
    });
  }, [liveSteps, steps]);

  if (liveSteps.length === 0) return null;

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  return (
    <div className="shrink-0 border-t bg-zinc-950">
      <button
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-zinc-900/50 transition-colors"
        onClick={() => setLogOpen(!logOpen)}
      >
        <span className="text-xs font-medium text-zinc-400">Deployment Log</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">{liveSteps.length} steps</span>
          {logOpen ? (
            <ChevronDown className="size-3.5 text-zinc-500" />
          ) : (
            <ChevronRight className="size-3.5 text-zinc-500" />
          )}
        </div>
      </button>
      {logOpen && (
        <div className="max-h-64 overflow-y-auto px-3 pb-3 space-y-1">
          {liveSteps.map((step: any, stepIdx: number) => {
            const stepInfo = steps.find((s: any) => s.id === step.stepId);
            const stepStatus = stepInfo?.status || "running";
            const anyRunning = step.servers.some((srv: any) => srv.isRunning);
            const expanded = expandedSteps.has(step.stepId);

            return (
              <div key={step.stepId} className="rounded border border-zinc-800">
                <button
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-900/50"
                  onClick={() => toggleStep(step.stepId)}
                >
                  {stepStatus === "completed" ? (
                    <CheckCircle2 className="size-3 text-green-500 shrink-0" />
                  ) : stepStatus === "failed" ? (
                    <XCircle className="size-3 text-red-500 shrink-0" />
                  ) : anyRunning ? (
                    <Loader2 className="size-3 text-primary animate-spin shrink-0" />
                  ) : (
                    <Circle className="size-3 text-zinc-600 shrink-0" />
                  )}
                  <span className="text-[11px] font-mono text-zinc-400 flex-1 truncate">
                    {stepIdx + 1}. {step.stepName}
                  </span>
                  {stepStatus === "completed" && !expanded && (
                    <span className="text-[10px] text-green-600">OK</span>
                  )}
                  {stepStatus === "failed" && (
                    <span className="text-[10px] text-red-400">FAILED</span>
                  )}
                  {expanded ? (
                    <ChevronDown className="size-3 text-zinc-600 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3 text-zinc-600 shrink-0" />
                  )}
                </button>
                {expanded && (
                  <div className="border-t border-zinc-800 px-2 py-1.5 space-y-1">
                    {stepInfo?.resolvedCommand && (
                      <pre className="p-1.5 rounded bg-blue-950/50 border border-blue-900/30 text-[10px] font-mono text-blue-300 whitespace-pre-wrap">
                        {"$ " + stepInfo.resolvedCommand.split("\n").filter((l: string) => l !== "set -e" && !l.startsWith("export ")).join("\n$ ")}
                      </pre>
                    )}
                    {step.servers.map((server: any) => (
                      <FullLogEntry
                        key={server.serverId}
                        server={server}
                        collapsed={false}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
