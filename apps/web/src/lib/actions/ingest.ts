"use server";

import { prisma, type Prisma } from "@forgespecs/db";
import { enqueueGeneration } from "@forgespecs/jobs";
import { withPermission, type Scope } from "@forgespecs/core";
import {
  encryptToken,
  parseAllowedRoots,
  resolveAllowedLocalPath,
  type SealedToken,
} from "@forgespecs/core/ingest";

import "@/lib/auth/rbac"; // installs the RBAC provider
import { ensureGenerationWorker } from "@/lib/generation/runner";

/**
 * Repo ingest control plane (M12). Creates a RepoIngestSource (encrypting the
 * GitHub PAT if any) + a GenerationJob (kind=REPO_INGEST) and enqueues it onto
 * the existing generation queue. The runner dispatches by kind, so we reuse the
 * BullMQ worker / inline-fallback infrastructure without a new queue.
 *
 * RBAC: requires `doc.create` AND `ai.invoke` at the project scope — the same
 * gate as the architecture wizard, since ingest creates many documents.
 */

const projectScope = (workspaceId: string, projectId: string): Scope => ({
  kind: "project",
  workspaceId,
  projectId,
});

export interface StartRepoIngestInput {
  workspaceId: string;
  projectId: string;
  source:
    | { kind: "LOCAL"; path: string }
    | { kind: "GITHUB"; ref: string; branch?: string; token?: string };
}

const _startRepoIngest = withPermission(
  (input: StartRepoIngestInput) =>
    projectScope(input.workspaceId, input.projectId),
  "doc.create",
  async (
    actor,
    input,
  ): Promise<{ jobId: string; inline: boolean }> => {
    let kind: "LOCAL" | "GITHUB";
    let ref: string;
    let branch: string | undefined;
    let sealedToken: SealedToken | null = null;

    if (input.source.kind === "LOCAL") {
      kind = "LOCAL";
      // Validate against allowlist at submit time too, so the user gets a fast
      // error instead of having to wait for the worker to pick the job up.
      const allowed = parseAllowedRoots(process.env.INGEST_LOCAL_ALLOWED_ROOTS);
      ref = resolveAllowedLocalPath({
        rawPath: input.source.path,
        allowedRoots: allowed,
      });
    } else {
      kind = "GITHUB";
      const trimmed = input.source.ref.trim();
      if (!/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
        throw new Error("GitHub ref must be in the form 'owner/repo'.");
      }
      ref = trimmed;
      branch = input.source.branch?.trim() || undefined;
      if (input.source.token?.trim()) {
        const secret = process.env.BETTER_AUTH_SECRET;
        if (!secret) {
          throw new Error("BETTER_AUTH_SECRET is unset; cannot encrypt token.");
        }
        sealedToken = encryptToken(input.source.token.trim(), secret);
      }
    }

    // One ingest source per project — upsert so a re-ingest with new
    // credentials swaps them in cleanly.
    await prisma.repoIngestSource.upsert({
      where: { projectId: input.projectId },
      create: {
        projectId: input.projectId,
        kind,
        ref,
        branch,
        tokenCipher: sealedToken?.cipher,
        tokenIv: sealedToken?.iv,
        tokenTag: sealedToken?.tag,
      },
      update: {
        kind,
        ref,
        branch,
        // Only overwrite token when one was supplied this round; otherwise keep
        // the previously stored credentials (re-runs don't require re-pasting).
        ...(sealedToken
          ? {
              tokenCipher: sealedToken.cipher,
              tokenIv: sealedToken.iv,
              tokenTag: sealedToken.tag,
            }
          : {}),
      },
    });

    const job = await prisma.generationJob.create({
      data: {
        projectId: input.projectId,
        createdById: actor.userId,
        kind: "REPO_INGEST",
        status: "PENDING",
        input: { kind, ref, branch } as unknown as Prisma.InputJsonValue,
        progress: {
          status: "pending",
          stage: "fetch",
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    ensureGenerationWorker();
    const { inline } = await enqueueGeneration(job.id);
    return { jobId: job.id, inline };
  },
);

/** Start a repo ingest. Returns the GenerationJob id (poll via getGenerationJob). */
export async function startRepoIngest(
  input: StartRepoIngestInput,
): Promise<{ jobId: string; inline: boolean }> {
  return _startRepoIngest(input);
}

export interface IngestSourceInfo {
  configured: boolean;
  kind: "LOCAL" | "GITHUB" | null;
  ref: string | null;
  branch: string | null;
  lastIngestAt: string | null;
  hasToken: boolean;
}

const _getIngestSource = withPermission(
  (input: { workspaceId: string; projectId: string }) =>
    projectScope(input.workspaceId, input.projectId),
  "ai.invoke",
  async (_actor, input): Promise<IngestSourceInfo> => {
    const row = await prisma.repoIngestSource.findUnique({
      where: { projectId: input.projectId },
      select: {
        kind: true,
        ref: true,
        branch: true,
        lastIngestAt: true,
        tokenCipher: true,
      },
    });
    if (!row) {
      return {
        configured: false,
        kind: null,
        ref: null,
        branch: null,
        lastIngestAt: null,
        hasToken: false,
      };
    }
    return {
      configured: true,
      kind: row.kind,
      ref: row.ref,
      branch: row.branch,
      lastIngestAt: row.lastIngestAt?.toISOString() ?? null,
      hasToken: row.tokenCipher !== null,
    };
  },
);

/** Read the current ingest source (for the UI). The token plaintext is never returned. */
export async function getIngestSource(input: {
  workspaceId: string;
  projectId: string;
}): Promise<IngestSourceInfo> {
  return _getIngestSource(input);
}

export interface IngestServerInfo {
  /** Local-path mode is available in the form. */
  localEnabled: boolean;
  /** AI is configured — synthesis pass will run. */
  aiAvailable: boolean;
}

/** Surface the server's ingest config so the form can render appropriate fields. */
export async function getIngestServerInfo(): Promise<IngestServerInfo> {
  const allowed = parseAllowedRoots(process.env.INGEST_LOCAL_ALLOWED_ROOTS);
  // hasApiKey from @forgespecs/ai is server-only; we read OPENROUTER_API_KEY
  // directly to keep this server action import-light.
  return {
    localEnabled: allowed.length > 0,
    aiAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  };
}

export interface IngestProgressDto {
  jobId: string;
  status: string;
  stage:
    | "fetch"
    | "walk"
    | "verbatim"
    | "summarize"
    | "synthesize"
    | "finalize"
    | "done";
  fetchedAt: string | null;
  walkedFiles: number | null;
  verbatim: { created: number; updated: number; skipped: number } | null;
  summarize: { done: number; total: number } | null;
  synthesize: { emitted: number; error?: string } | null;
  finalized: boolean;
  ai: { skipped: boolean; reason?: string } | null;
  error: string | null;
}

const _getIngestJob = withPermission(
  (input: { jobId: string; scope: Scope }) => input.scope,
  "ai.invoke",
  async (_actor, input): Promise<IngestProgressDto | null> => {
    const job = await prisma.generationJob.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        status: true,
        progress: true,
        error: true,
      },
    });
    if (!job) return null;
    const raw = (job.progress ?? {}) as Record<string, unknown>;
    return {
      jobId: job.id,
      status: job.status,
      stage: (raw.stage as IngestProgressDto["stage"]) ?? "fetch",
      fetchedAt: (raw.fetchedAt as string | undefined) ?? null,
      walkedFiles: (raw.walkedFiles as number | undefined) ?? null,
      verbatim:
        (raw.verbatim as IngestProgressDto["verbatim"] | undefined) ?? null,
      summarize:
        (raw.summarize as IngestProgressDto["summarize"] | undefined) ?? null,
      synthesize:
        (raw.synthesize as IngestProgressDto["synthesize"] | undefined) ?? null,
      finalized: Boolean(raw.finalized),
      ai: (raw.ai as IngestProgressDto["ai"] | undefined) ?? null,
      error: job.error,
    };
  },
);

/** Poll a repo-ingest job's persisted progress. */
export async function getIngestJob(input: {
  jobId: string;
  scope: Scope;
}): Promise<IngestProgressDto | null> {
  return _getIngestJob(input);
}
