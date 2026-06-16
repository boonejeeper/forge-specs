import "server-only";

import { prisma } from "@forgespecs/db";
import {
  hasApiKey,
  generateArchitecture,
  generateTasks,
  genBlocksToBlockNote,
  type ArchitectureInput,
} from "@forgespecs/ai";
import {
  registerGenerationRunner,
  startGenerationWorker,
  isRedisEnabled,
  type GenerationRunner,
} from "@forgespecs/jobs";
import type { GeneratedPlanInput, Scope } from "@forgespecs/core";

import { materializeArchitecture } from "./materialize";
import { createDocument, saveDocumentContent } from "@/lib/actions/documents";

/**
 * The generation runner the jobs package invokes (inline when Redis is absent,
 * or from the BullMQ generation worker). For a GenerationJob row it:
 *   1. generates the architecture tree (AI, no Postgres-of-record writes), then
 *   2. materializes it via the human mutation paths (createDocument / etc.).
 *
 * Resumable + idempotent: materialization keys on (jobId, docRef) and persists
 * progress on GenerationJob.progress, so a re-invocation (retry/resume/refresh)
 * skips work already done. Graceful: no API key → mark the job failed with a
 * clear message rather than throwing into the queue.
 */
export const runGenerationJob: GenerationRunner = async (generationJobId) => {
  const job = await prisma.generationJob.findUnique({
    where: { id: generationJobId },
    select: { input: true, projectId: true, progress: true, kind: true },
  });
  if (!job) {
    console.error(`[generation] job ${generationJobId} not found`);
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id: job.projectId },
    select: { workspaceId: true },
  });
  if (!project) {
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: "FAILED", error: "Project not found." },
    });
    return;
  }

  const scope: Scope = {
    kind: "project",
    workspaceId: project.workspaceId,
    projectId: job.projectId,
  };

  if (!hasApiKey()) {
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: {
        status: "FAILED",
        error:
          "AI is not configured (OPENROUTER_API_KEY unset); cannot generate.",
      },
    });
    return;
  }

  // ── agent-run (@agent mention) — generate tasks from the source doc and seed
  // a new TASK_PLAN document. Reuses the generate flows; resumable via the row.
  const rawInput = (job.input ?? {}) as Record<string, unknown>;
  if (job.kind === "TASKS" && rawInput.kind === "agent-run") {
    try {
      const sourceDocId = rawInput.sourceDocumentId as string | undefined;
      let source = "";
      if (sourceDocId) {
        const src = await prisma.document.findUnique({
          where: { id: sourceDocId },
          select: { title: true, contentText: true },
        });
        if (src) source = `${src.title}\n\n${src.contentText}`.trim();
      }
      if (source) {
        const { blocks } = await generateTasks({ source });
        const doc = await createDocument({
          workspaceId: scope.workspaceId,
          projectId: job.projectId,
          type: "TASK_PLAN",
          title: `Agent tasks (${(rawInput.agentName as string) ?? "agent"})`,
        });
        await saveDocumentContent({
          documentId: doc.id,
          contentJSON: blocks,
          scope,
        });
      }
      await prisma.generationJob.update({
        where: { id: generationJobId },
        data: { status: "COMPLETED" },
      });
    } catch (err) {
      await prisma.generationJob.update({
        where: { id: generationJobId },
        data: {
          status: "FAILED",
          error: err instanceof Error ? err.message : "Agent run failed.",
        },
      });
    }
    return;
  }

  const input = (job.input ?? {}) as unknown as ArchitectureInput;

  let plan: GeneratedPlanInput;
  try {
    const arch = await generateArchitecture({
      idea: input.idea ?? "",
      requirements: input.requirements,
      constraints: input.constraints,
      techPrefs: input.techPrefs,
    });
    // Materialize each node's generator blocks into BlockNote bodies up front so
    // the materializer only deals with editor-ready content.
    plan = {
      nodes: arch.nodes.map((n) => ({
        ref: n.ref,
        parentRef: n.parentRef,
        type: n.type,
        title: n.title,
        summary: n.summary,
        blocks: genBlocksToBlockNote(n.blocks),
      })),
      edges: arch.edges,
    };
  } catch (err) {
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : "Generation failed.",
      },
    });
    return;
  }

  await materializeArchitecture({ jobId: generationJobId, scope, plan });
};

let registered = false;
let workerStarted = false;

/**
 * Idempotently register the runner with the jobs package (inline + worker).
 *
 * The generation worker (BullMQ consumer) is started IN THE WEB PROCESS because
 * only it can register the runner (which calls the web-only server actions /
 * RBAC). When Redis is absent, jobs run inline instead — same runner, no worker.
 * The standalone `worker` service only handles embeddings; generation stays with
 * the web process so the human mutation paths stay in one place.
 */
export function ensureGenerationRunner(): void {
  // Registering the runner is pure in-memory wiring (no Redis), so it is always
  // safe — it gives the inline fallback something to call. Starting the BullMQ
  // worker, however, opens a Redis connection, so it is deferred to the first
  // actual enqueue (see ensureGenerationWorker) and never runs at import or build.
  if (!registered) {
    registerGenerationRunner(runGenerationJob);
    registered = true;
  }
}

/**
 * Lazily start the generation worker — ONLY when Redis is actually enabled and a
 * job is about to be enqueued. Importing this module (or running `next build`)
 * never opens a Redis connection because isRedisEnabled() is false during the
 * build phase and when REDIS_URL is unset.
 */
export function ensureGenerationWorker(): void {
  ensureGenerationRunner();
  if (!workerStarted && isRedisEnabled()) {
    try {
      startGenerationWorker();
      workerStarted = true;
    } catch (err) {
      console.error("[generation] failed to start generation worker:", err);
    }
  }
}

// Register the runner on import (cheap, no connection) so any enqueue path has
// the inline fallback available. The worker is started on demand, not here.
ensureGenerationRunner();
