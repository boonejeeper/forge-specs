/**
 * Job processors — the single implementation of each job's work, shared by the
 * inline fallback (queues.ts) and the BullMQ Worker (worker.ts). Keeping the
 * work here (not in the Worker callback) is what makes the inline-vs-queued
 * choice transparent to producers.
 */
import type { PrismaClient } from "@forgespecs/db";
import { embedDocumentSafe, type EmbedDocumentResult } from "@forgespecs/ai";

/**
 * Embedding refresh for one document. Delegates to the AI package's
 * `embedDocumentSafe` (incremental, hash-deduped, no-op without an API key,
 * never throws). Returns the result for the worker's logging.
 */
export async function runEmbedDocument(
  prisma: PrismaClient,
  documentId: string,
): Promise<EmbedDocumentResult> {
  return embedDocumentSafe(prisma, documentId);
}
