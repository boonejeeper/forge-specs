"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
  FileText,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import {
  getGenerationJob,
  resumeArchitectureGeneration,
  type GenerationJobDto,
} from "@/lib/actions/generation";
import type { Scope } from "@forgespecs/core";

/**
 * Generate Complete Architecture wizard. Multi-step form, then a live view of
 * the doc tree materializing.
 *
 * Resumability: the job id is persisted to sessionStorage so a refresh resumes
 * polling the SAME job (which itself is crash-safe + idempotent on the server).
 * Stop = stop polling locally (the server job keeps its progress; Resume
 * re-enqueues + restarts polling). Per-doc state comes from the persisted job
 * progress (the core job-state reducer), so the UI is a pure projection.
 */

const STEPS = [
  { key: "idea", label: "Idea", placeholder: "Build a self-hosted AI agent OS" },
  {
    key: "requirements",
    label: "Requirements",
    placeholder: "Multi-tenant, RBAC, real-time collab, audit trail…",
  },
  {
    key: "constraints",
    label: "Constraints",
    placeholder: "Self-hosted via docker-compose, no vendor lock-in…",
  },
  {
    key: "techPrefs",
    label: "Tech preferences",
    placeholder: "Next.js, Postgres + pgvector, TypeScript…",
  },
] as const;

type FormKey = (typeof STEPS)[number]["key"];

const STORAGE_KEY = (projectId: string): string => `forge:gen-arch:${projectId}`;

export function GenerateArchitectureWizard({
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
}: {
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const scope: Scope = { kind: "project", workspaceId, projectId };

  const [form, setForm] = React.useState<Record<FormKey, string>>({
    idea: "",
    requirements: "",
    constraints: "",
    techPrefs: "",
  });
  const [step, setStep] = React.useState(0);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<GenerationJobDto | null>(null);
  const [polling, setPolling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Resume an in-flight job for this project after a refresh.
  React.useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY(projectId));
    if (saved) {
      setJobId(saved);
      setPolling(true);
    }
  }, [projectId]);

  // Poll the job's persisted progress while running.
  React.useEffect(() => {
    if (!jobId || !polling) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const dto = await getGenerationJob({ jobId, scope });
        if (cancelled) return;
        setJob(dto);
        // Invalidate the spec tree so newly created docs appear in the sidebar.
        qc.invalidateQueries({ queryKey: queryKeys.documents.tree(projectId) });
        if (
          dto &&
          (dto.state.status === "completed" ||
            dto.state.status === "failed" ||
            dto.state.status === "canceled")
        ) {
          setPolling(false);
          sessionStorage.removeItem(STORAGE_KEY(projectId));
        }
      } catch {
        /* transient — keep polling */
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, polling, projectId]);

  const start = async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-arch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, workspaceId, projectId }),
      });
      const data = (await res.json()) as {
        jobId?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok && res.status !== 202) {
        setError(data.message ?? data.error ?? "Failed to start generation.");
        return;
      }
      if (data.error === "ai_unavailable") {
        setError(data.message ?? "AI is not configured.");
        return;
      }
      if (data.jobId) {
        sessionStorage.setItem(STORAGE_KEY(projectId), data.jobId);
        setJobId(data.jobId);
        setPolling(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start generation.");
    }
  };

  const stop = (): void => {
    setPolling(false);
  };

  const resume = async (): Promise<void> => {
    if (!jobId) return;
    setPolling(true);
    await resumeArchitectureGeneration({ jobId, scope }).catch(() => {});
  };

  const reset = (): void => {
    sessionStorage.removeItem(STORAGE_KEY(projectId));
    setJobId(null);
    setJob(null);
    setPolling(false);
    setStep(0);
  };

  // ── form mode ──────────────────────────────────────────────────────────────
  if (!jobId) {
    const current = STEPS[step]!;
    const canContinue = step > 0 || form.idea.trim().length > 0;
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Generate complete architecture</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Describe your system and we&apos;ll generate a Vision, PRD, RFC tree,
          ADRs, DB schema, event model, API sketch, deployment runbook, and
          roadmap — interlinked and editable.
        </p>

        <ol className="flex gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={cn(
                "rounded-full px-2.5 py-1",
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-muted text-foreground"
                    : "bg-muted/50 text-muted-foreground",
              )}
            >
              {s.label}
            </li>
          ))}
        </ol>

        <div className="space-y-2">
          <Label htmlFor={current.key}>
            {current.label}
            {current.key === "idea" ? " (required)" : " (optional)"}
          </Label>
          {current.key === "idea" ? (
            <Input
              id={current.key}
              value={form[current.key]}
              placeholder={current.placeholder}
              onChange={(e) =>
                setForm((f) => ({ ...f, [current.key]: e.target.value }))
              }
            />
          ) : (
            <textarea
              id={current.key}
              value={form[current.key]}
              placeholder={current.placeholder}
              rows={5}
              onChange={(e) =>
                setForm((f) => ({ ...f, [current.key]: e.target.value }))
              }
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <div className="flex justify-between">
          <Button
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <Button disabled={!form.idea.trim()} onClick={() => void start()}>
              <Sparkles className="size-4" /> Generate
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── live materialization view ───────────────────────────────────────────────
  const state = job?.state;
  const docs = state?.docs ?? [];
  const total = state?.totalDocs ?? 0;
  const done = docs.filter((d) => d.status === "done").length;
  const running = polling && state?.status !== "completed";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Generating architecture</h1>
        </div>
        <div className="flex gap-2">
          {running ? (
            <Button variant="outline" size="sm" onClick={stop}>
              Stop
            </Button>
          ) : state?.status !== "completed" ? (
            <Button variant="outline" size="sm" onClick={() => void resume()}>
              <RotateCcw className="size-3.5" /> Resume
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={reset}>
            New
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {state?.status === "completed"
              ? "Complete"
              : state?.status === "failed"
                ? "Finished with errors"
                : running
                  ? "Generating…"
                  : "Paused"}
          </span>
          <span className="text-muted-foreground">
            {done}/{total || "…"} docs
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: total ? `${(done / total) * 100}%` : "5%" }}
          />
        </div>
      </div>

      {job?.error ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="size-4" /> {job.error}
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {docs.length === 0 ? (
          <li className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Planning the document tree…
          </li>
        ) : (
          docs.map((d) => (
            <li
              key={d.docRef}
              className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              {d.status === "done" ? (
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : d.status === "error" ? (
                <AlertCircle className="size-4 text-destructive" />
              ) : (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {d.title ?? d.docRef}
              </span>
              {d.type ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {d.type}
                </span>
              ) : null}
              {d.status === "done" && d.documentId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    router.push(
                      `/${workspaceSlug}/${projectSlug}/specs/${d.documentId}`,
                    )
                  }
                >
                  Open
                </Button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
