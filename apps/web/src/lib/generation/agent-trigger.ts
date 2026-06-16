import "server-only";

import { prisma, type Prisma as PrismaTypes } from "@forgespecs/db";
import { hasApiKey } from "@forgespecs/ai";
import { enqueueGeneration } from "@forgespecs/jobs";
import { initialJobState } from "@forgespecs/core";

import { ensureGenerationWorker } from "@/lib/generation/runner"; // registers runner + lazily starts worker

/**
 * @agent mention → AI run trigger (M7).
 *
 * When an `isAgent` Mention is created (via the comment composer's
 * `@[agent](agent:architect)` token — see core parseMentions), this enqueues an
 * agent task. We reuse the resumable GenerationJob machinery: an agent run is a
 * GenerationJob whose input carries the mentioning document + the agent name, so
 * it gets the same crash-safe, idempotent, resumable execution as the wizard.
 *
 * The actual agent work reuses the generate flows (the runner branches on
 * job.kind / input). This file is only the TRIGGER + ENQUEUE — it never blocks
 * the comment write and never throws into it. Graceful: no API key → no-op.
 */
export async function triggerAgentRun(params: {
  documentId: string;
  agentName: string;
  actorId: string;
}): Promise<void> {
  if (!hasApiKey()) return; // AI unprovisioned → silently skip.

  try {
    const doc = await prisma.document.findUnique({
      where: { id: params.documentId },
      select: { projectId: true, title: true },
    });
    if (!doc) return;

    // An agent run is modelled as a TASKS GenerationJob seeded from the doc, so
    // it inherits resumable + idempotent progress tracking.
    const job = await prisma.generationJob.create({
      data: {
        projectId: doc.projectId,
        createdById: params.actorId,
        kind: "TASKS",
        status: "PENDING",
        input: {
          agentName: params.agentName,
          sourceDocumentId: params.documentId,
          kind: "agent-run",
        } as unknown as PrismaTypes.InputJsonValue,
        progress: initialJobState() as unknown as PrismaTypes.InputJsonValue,
      },
      select: { id: true },
    });

    ensureGenerationWorker();
    await enqueueGeneration(job.id);
  } catch (err) {
    // Never let an agent trigger failure break the originating comment.
    console.error("[agent-trigger] failed to enqueue agent run:", err);
  }
}
