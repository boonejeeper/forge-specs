"use server";

import { prisma, type Prisma } from "@forgespecs/db";
import { enqueueGeneration } from "@forgespecs/jobs";
import {
  withPermission,
  initialJobState,
  type GenerationJobState,
  type Scope,
} from "@forgespecs/core";

import "@/lib/auth/rbac"; // installs the RBAC provider
import { ensureGenerationWorker } from "@/lib/generation/runner"; // registers runner + lazily starts worker

/**
 * GenerationJob Server Actions (M7) — the resumable architecture wizard's
 * control plane.
 *
 * `startArchitectureGeneration` creates a GenerationJob row (input + initial
 * progress) then enqueues it. With Redis the BullMQ worker runs it; without
 * Redis it runs inline (fire-and-forget) but progress is still persisted on the
 * row, so a page refresh resumes by polling `getGenerationJob`.
 *
 * RBAC: requires `ai.invoke` AND `doc.create` (the job creates documents) at the
 * project scope — gated through the single chokepoint.
 */

const projectScope = (workspaceId: string, projectId: string): Scope => ({
  kind: "project",
  workspaceId,
  projectId,
});

export interface ArchitectureGenerationInput {
  idea: string;
  requirements?: string;
  constraints?: string;
  techPrefs?: string;
}

const _startArchitectureGeneration = withPermission(
  (input: {
    workspaceId: string;
    projectId: string;
    input: ArchitectureGenerationInput;
  }) => projectScope(input.workspaceId, input.projectId),
  "doc.create",
  async (
    actor,
    input,
  ): Promise<{ jobId: string; inline: boolean }> => {
    if (!input.input.idea?.trim()) {
      throw new Error("An idea is required to generate an architecture.");
    }
    const job = await prisma.generationJob.create({
      data: {
        projectId: input.projectId,
        createdById: actor.userId,
        kind: "ARCHITECTURE",
        status: "PENDING",
        input: input.input as unknown as Prisma.InputJsonValue,
        progress: initialJobState() as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    ensureGenerationWorker();
    const { inline } = await enqueueGeneration(job.id);
    return { jobId: job.id, inline };
  },
);

/** Kick off a resumable architecture generation job. Returns the job id. */
export async function startArchitectureGeneration(input: {
  workspaceId: string;
  projectId: string;
  input: ArchitectureGenerationInput;
}): Promise<{ jobId: string; inline: boolean }> {
  return _startArchitectureGeneration(input);
}

export interface GenerationJobDto {
  id: string;
  status: string;
  kind: string;
  state: GenerationJobState;
  error: string | null;
}

const _getGenerationJob = withPermission(
  (input: { jobId: string; scope: Scope }) => input.scope,
  "ai.invoke",
  async (_actor, input): Promise<GenerationJobDto | null> => {
    const job = await prisma.generationJob.findUnique({
      where: { id: input.jobId },
      select: { id: true, status: true, kind: true, progress: true, error: true },
    });
    if (!job) return null;
    const state =
      job.progress &&
      typeof job.progress === "object" &&
      "status" in (job.progress as object)
        ? (job.progress as unknown as GenerationJobState)
        : initialJobState();
    return {
      id: job.id,
      status: job.status,
      kind: job.kind,
      state,
      error: job.error,
    };
  },
);

/** Poll a generation job's persisted progress (resumable wizard UI). */
export async function getGenerationJob(input: {
  jobId: string;
  scope: Scope;
}): Promise<GenerationJobDto | null> {
  return _getGenerationJob(input);
}

const _resumeArchitectureGeneration = withPermission(
  (input: { jobId: string; scope: Scope }) => input.scope,
  "doc.create",
  async (_actor, input): Promise<{ jobId: string; inline: boolean }> => {
    const job = await prisma.generationJob.findUniqueOrThrow({
      where: { id: input.jobId },
      select: { id: true, status: true },
    });
    if (job.status === "COMPLETED") {
      return { jobId: job.id, inline: false };
    }
    ensureGenerationWorker();
    const { inline } = await enqueueGeneration(job.id);
    return { jobId: job.id, inline };
  },
);

/** Re-enqueue a job to resume it after a disconnect/crash (idempotent). */
export async function resumeArchitectureGeneration(input: {
  jobId: string;
  scope: Scope;
}): Promise<{ jobId: string; inline: boolean }> {
  return _resumeArchitectureGeneration(input);
}
