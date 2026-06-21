"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Loader2,
  Check,
  AlertCircle,
  Cloud,
  HardDrive,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import {
  getIngestJob,
  getIngestServerInfo,
  type IngestProgressDto,
  type IngestServerInfo,
} from "@/lib/actions/ingest";
import type { Scope } from "@forgespecs/core";

/**
 * Repo ingest flow — form (source kind + ref + optional token) → live progress
 * (stage-by-stage). The job id is persisted to sessionStorage so a refresh
 * resumes polling the SAME job (the server job state lives in
 * GenerationJob.progress, so all of this is just a UI projection).
 */

const STORAGE_KEY = (projectId: string): string => `forge:ingest:${projectId}`;

const STAGES = [
  { key: "fetch", label: "Fetch" },
  { key: "walk", label: "Walk" },
  { key: "verbatim", label: "Verbatim import" },
  { key: "summarize", label: "Summarize code" },
  { key: "synthesize", label: "Synthesize docs" },
  { key: "finalize", label: "Finalize" },
  { key: "done", label: "Done" },
] as const;

type SourceKind = "LOCAL" | "GITHUB";

export function IngestFlow({
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
  serverInfo,
}: {
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  serverInfo: IngestServerInfo;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const scope: Scope = { kind: "project", workspaceId, projectId };

  const [sourceKind, setSourceKind] = React.useState<SourceKind>(
    serverInfo.localEnabled ? "LOCAL" : "GITHUB",
  );
  const [localPath, setLocalPath] = React.useState(
    serverInfo.localEnabled ? "/repo" : "",
  );
  const [ghRef, setGhRef] = React.useState("");
  const [ghBranch, setGhBranch] = React.useState("");
  const [ghToken, setGhToken] = React.useState("");
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<IngestProgressDto | null>(null);
  const [polling, setPolling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY(projectId));
    if (saved) {
      setJobId(saved);
      setPolling(true);
    }
  }, [projectId]);

  React.useEffect(() => {
    if (!jobId || !polling) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const dto = await getIngestJob({ jobId, scope });
        if (cancelled) return;
        setJob(dto);
        qc.invalidateQueries({ queryKey: queryKeys.documents.tree(projectId) });
        if (
          dto &&
          (dto.status === "COMPLETED" ||
            dto.status === "FAILED" ||
            dto.status === "CANCELED")
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
    const source =
      sourceKind === "LOCAL"
        ? { kind: "LOCAL" as const, path: localPath.trim() }
        : {
            kind: "GITHUB" as const,
            ref: ghRef.trim(),
            branch: ghBranch.trim() || undefined,
            token: ghToken.trim() || undefined,
          };
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId, source }),
      });
      const data = (await res.json()) as {
        jobId?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok && res.status !== 202) {
        setError(data.message ?? data.error ?? "Failed to start ingest.");
        return;
      }
      if (data.jobId) {
        sessionStorage.setItem(STORAGE_KEY(projectId), data.jobId);
        setJobId(data.jobId);
        setPolling(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start ingest.");
    }
  };

  const reset = (): void => {
    sessionStorage.removeItem(STORAGE_KEY(projectId));
    setJobId(null);
    setJob(null);
    setPolling(false);
  };

  // ── form mode ───────────────────────────────────────────────────────────────
  if (!jobId) {
    const canSubmit =
      sourceKind === "LOCAL"
        ? Boolean(localPath.trim())
        : /^[^/\s]+\/[^/\s]+$/.test(ghRef.trim());
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Boxes className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Import from a repo</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Point ForgeSpecs at a repository — markdown docs are imported verbatim,
          code files are summarized, and the AI synthesizes a clean canonical
          doc set (VISION, RFCs, ADRs, API spec, DB schema, runbook).
          {serverInfo.aiAvailable
            ? null
            : " AI is not configured on this server — only the verbatim import will run."}
        </p>

        <div className="space-y-3">
          <Label>Source</Label>
          <div className="grid grid-cols-2 gap-3">
            <SourceCard
              icon={HardDrive}
              label="Local path"
              description={
                serverInfo.localEnabled
                  ? "A folder on this server (allowlisted)"
                  : "Disabled — INGEST_LOCAL_ALLOWED_ROOTS unset"
              }
              selected={sourceKind === "LOCAL"}
              disabled={!serverInfo.localEnabled}
              onClick={() => setSourceKind("LOCAL")}
            />
            <SourceCard
              icon={Cloud}
              label="GitHub"
              description="Public or private (PAT)"
              selected={sourceKind === "GITHUB"}
              onClick={() => setSourceKind("GITHUB")}
            />
          </div>
        </div>

        {sourceKind === "LOCAL" ? (
          <div className="space-y-2">
            <Label htmlFor="localPath">Absolute path</Label>
            <Input
              id="localPath"
              value={localPath}
              placeholder="/repo"
              onChange={(e) => setLocalPath(e.target.value)}
              disabled={!serverInfo.localEnabled}
            />
            <p className="text-xs text-muted-foreground">
              Must resolve under one of the allowed roots configured on the server.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ghRef">Repo (owner/repo)</Label>
              <Input
                id="ghRef"
                value={ghRef}
                placeholder="vercel/next.js"
                onChange={(e) => setGhRef(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ghBranch">Branch (optional)</Label>
              <Input
                id="ghBranch"
                value={ghBranch}
                placeholder="main"
                onChange={(e) => setGhBranch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ghToken">Personal access token (private repos)</Label>
              <Input
                id="ghToken"
                value={ghToken}
                type="password"
                autoComplete="off"
                placeholder="ghp_…"
                onChange={(e) => setGhToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Encrypted at rest with the server&apos;s auth secret. Never returned by any API.
              </p>
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end">
          <Button disabled={!canSubmit} onClick={() => void start()}>
            <Boxes className="size-4" /> Start ingest
          </Button>
        </div>
      </div>
    );
  }

  // ── progress mode ───────────────────────────────────────────────────────────
  const stage = job?.stage ?? "fetch";
  const running = polling && job?.status !== "COMPLETED" && job?.status !== "FAILED";
  const done = job?.status === "COMPLETED";
  const failed = job?.status === "FAILED";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Ingesting repository</h1>
        </div>
        <div className="flex items-center gap-2">
          {done ? (
            <Button
              size="sm"
              onClick={() => router.push(`/${workspaceSlug}/${projectSlug}`)}
            >
              View documents
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={reset}>
            <RotateCcw className="size-4" /> New ingest
          </Button>
        </div>
      </div>

      <ol className="space-y-2 text-sm">
        {STAGES.map((s) => {
          const stageIdx = STAGES.findIndex((x) => x.key === stage);
          const myIdx = STAGES.findIndex((x) => x.key === s.key);
          const isCurrent = s.key === stage && running;
          const isDone = myIdx < stageIdx || done;
          const isFail = failed && s.key === stage;
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2",
                isDone
                  ? "border-emerald-200 bg-emerald-50/40 text-foreground"
                  : isCurrent
                    ? "border-primary/30 bg-primary/5"
                    : isFail
                      ? "border-destructive/30 bg-destructive/5 text-destructive"
                      : "text-muted-foreground",
              )}
            >
              {isDone ? (
                <Check className="size-4 text-emerald-600" />
              ) : isCurrent ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : isFail ? (
                <AlertCircle className="size-4" />
              ) : (
                <span className="inline-block size-4" />
              )}
              <span className="font-medium">{s.label}</span>
              <StageDetail stageKey={s.key} job={job} />
            </li>
          );
        })}
      </ol>

      {failed ? (
        <p className="text-sm text-destructive">{job?.error ?? "Ingest failed."}</p>
      ) : null}
      {job?.ai?.skipped ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          AI is not configured on this server ({job.ai.reason ?? "OPENROUTER_API_KEY unset"})
          — the verbatim import ran; the AI synthesis pass was skipped.
        </p>
      ) : null}
      {job?.synthesize?.error ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          AI synthesis did not produce output ({job.synthesize.error}). The
          verbatim import succeeded — try Re-ingest to retry the synthesis pass.
        </p>
      ) : null}
    </div>
  );
}

function StageDetail({
  stageKey,
  job,
}: {
  stageKey: string;
  job: IngestProgressDto | null;
}): React.JSX.Element | null {
  if (!job) return null;
  switch (stageKey) {
    case "walk":
      return job.walkedFiles != null ? (
        <span className="ml-auto text-xs text-muted-foreground">
          {job.walkedFiles} files
        </span>
      ) : null;
    case "verbatim":
      return job.verbatim ? (
        <span className="ml-auto text-xs text-muted-foreground">
          {job.verbatim.created} new · {job.verbatim.updated} updated
          {job.verbatim.skipped ? ` · ${job.verbatim.skipped} skipped` : ""}
        </span>
      ) : null;
    case "summarize":
      return job.summarize ? (
        <span className="ml-auto text-xs text-muted-foreground">
          {job.summarize.done} / {job.summarize.total}
        </span>
      ) : null;
    case "synthesize":
      return job.synthesize ? (
        <span className="ml-auto text-xs text-muted-foreground">
          {job.synthesize.emitted} docs
        </span>
      ) : null;
    default:
      return null;
  }
}

function SourceCard({
  icon: Icon,
  label,
  description,
  selected,
  disabled,
  onClick,
}: {
  icon: typeof HardDrive;
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-full flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/40",
        disabled ? "cursor-not-allowed opacity-50" : "",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

export { type IngestServerInfo };
