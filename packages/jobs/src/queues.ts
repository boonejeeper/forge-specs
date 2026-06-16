/**
 * Queue definitions + producers, with an INLINE FALLBACK.
 *
 * The single queue today is `embedding` (async re-embed on save/compaction —
 * moved off the M3 inline call). The contract for producers:
 *
 *   await enqueueEmbedDocument(prisma, documentId)
 *
 * If Redis is enabled, this adds a deduplicated job (jobId === documentId so a
 * burst of saves collapses to one pending job) and returns immediately. If Redis
 * is NOT enabled, it runs the embedding inline (fire-and-forget, never throws) so
 * dev without Redis still refreshes embeddings — exactly the M3 behaviour.
 *
 * The actual work (the processor) lives in `processor.ts` and is shared by both
 * the inline path and the BullMQ Worker, so there is one implementation.
 */
import type { PrismaClient } from "@forgespecs/db";
import { Queue, type JobsOptions } from "bullmq";

import { getConnection, isRedisEnabled } from "./connection";
import { runEmbedDocument } from "./processor";

export const EMBEDDING_QUEUE = "embedding" as const;

export interface EmbedDocumentJob {
  documentId: string;
}

let embeddingQueue: Queue<EmbedDocumentJob> | undefined;

/** Lazily get (or create) the embedding queue. Only call when Redis is enabled. */
export function getEmbeddingQueue(): Queue<EmbedDocumentJob> {
  if (embeddingQueue) return embeddingQueue;
  embeddingQueue = new Queue<EmbedDocumentJob>(EMBEDDING_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  return embeddingQueue;
}

/**
 * Enqueue (or inline-run) an embedding refresh for a document. Safe to call
 * unconditionally from the save / compaction path. Never throws into the caller.
 *
 * Dedupe: jobId === documentId so repeated saves coalesce to a single waiting
 * job; BullMQ ignores a duplicate add while one with that id is waiting.
 */
export async function enqueueEmbedDocument(
  prisma: PrismaClient,
  documentId: string,
): Promise<{ enqueued: boolean; inline: boolean }> {
  if (!isRedisEnabled()) {
    // Inline fallback — same processor, fire-and-forget, swallow errors.
    void runEmbedDocument(prisma, documentId).catch((err) => {
      console.error(`[jobs] inline embed failed for ${documentId}:`, err);
    });
    return { enqueued: false, inline: true };
  }
  try {
    const opts: JobsOptions = { jobId: documentId };
    await getEmbeddingQueue().add("embed", { documentId }, opts);
    return { enqueued: true, inline: false };
  } catch (err) {
    // Redis unreachable at runtime → degrade to inline so saves still embed.
    console.error(`[jobs] enqueue failed, running inline for ${documentId}:`, err);
    void runEmbedDocument(prisma, documentId).catch(() => {});
    return { enqueued: false, inline: true };
  }
}

/** Close the queue (worker/producer shutdown, tests). */
export async function closeQueues(): Promise<void> {
  if (embeddingQueue) {
    await embeddingQueue.close().catch(() => {});
    embeddingQueue = undefined;
  }
}
