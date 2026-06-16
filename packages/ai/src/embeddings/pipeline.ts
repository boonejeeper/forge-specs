import type { PrismaClient } from "@forgespecs/db";
import { chunkBlocks, type SourceBlock } from "@forgespecs/core/search";

import { EMBED_MODEL_ID } from "../models";
import { hasApiKey } from "../provider";
import { embedTexts } from "./embed";

/**
 * Embedding pipeline for a single document.
 *
 * Flow: load the document's projected Block rows → block-aligned chunking →
 * hash-dedupe against existing Embedding rows for this (document, model) → embed
 * only the chunks whose hashes are new → in ONE transaction, delete the stale
 * rows (chunks that disappeared or changed) and insert the new ones.
 *
 * The `Embedding.embedding` column is `Unsupported(vector(1536))`, so it cannot
 * be written through Prisma's typed create. We insert via parameterized raw SQL
 * casting the array literal to `::vector`. Everything else (content, hash,
 * model, chunkIndex, blockId) goes through the same INSERT.
 *
 * GRACEFUL DEGRADATION: with no API key this is a no-op that returns a zeroed
 * result, so the M2 save path can fire-and-forget it unconditionally.
 *
 * INCREMENTAL: identical content → identical chunk hashes → nothing re-embedded.
 * This is what makes it cheap to call on every (debounced) save and, in M6, from
 * the BullMQ-backed compaction refresh.
 */

export interface EmbedDocumentResult {
  documentId: string;
  /** Chunks embedded this run (new/changed). */
  embedded: number;
  /** Chunks reused from existing rows (unchanged). */
  reused: number;
  /** Stale rows removed (changed/deleted chunks, or model mismatch). */
  removed: number;
  /** True when the run was skipped because no API key is configured. */
  skipped: boolean;
}

function emptyResult(documentId: string, skipped: boolean): EmbedDocumentResult {
  return { documentId, embedded: 0, reused: 0, removed: 0, skipped };
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((n) => Number(n)).join(",")}]`;
}

export async function embedDocument(
  prisma: PrismaClient,
  documentId: string,
): Promise<EmbedDocumentResult> {
  if (!hasApiKey()) return emptyResult(documentId, true);

  // Source: the projected Block rows (already maintained by saveDocumentContent
  // / M4 compaction). Block-aligned so Embedding.blockId is meaningful.
  const blocks = await prisma.block.findMany({
    where: { documentId },
    orderBy: [{ parentId: "asc" }, { order: "asc" }],
    select: { id: true, text: true },
  });

  const sources: SourceBlock[] = blocks
    .filter((b) => b.text.trim().length > 0)
    .map((b) => ({ id: b.id, text: b.text }));

  const chunks = chunkBlocks(sources);

  // Existing embedding rows for this doc + current model.
  const existing = await prisma.embedding.findMany({
    where: { documentId },
    select: { id: true, contentHash: true, model: true },
  });
  const existingByHash = new Map(
    existing
      .filter((e) => e.model === EMBED_MODEL_ID)
      .map((e) => [e.contentHash, e.id]),
  );

  const wantedHashes = new Set(chunks.map((c) => c.hash));

  // Rows to drop: anything not wanted anymore, or from a different model
  // (dimension lock-in safety — re-embed under the new model).
  const staleIds = existing
    .filter((e) => e.model !== EMBED_MODEL_ID || !wantedHashes.has(e.contentHash))
    .map((e) => e.id);

  // Chunks that need embedding (no existing row with that hash).
  const newChunks = chunks.filter((c) => !existingByHash.has(c.hash));
  const reused = chunks.length - newChunks.length;

  // Nothing to do? Still drop stale rows (e.g. content shrank).
  if (newChunks.length === 0 && staleIds.length === 0) {
    return { documentId, embedded: 0, reused, removed: 0, skipped: false };
  }

  const embedResult =
    newChunks.length > 0 ? await embedTexts(newChunks.map((c) => c.content)) : null;

  // embedTexts returns null only when the key vanished between checks — treat as
  // a skip rather than a partial write.
  if (newChunks.length > 0 && !embedResult) {
    return emptyResult(documentId, true);
  }

  await prisma.$transaction(async (tx) => {
    if (staleIds.length > 0) {
      await tx.embedding.deleteMany({ where: { id: { in: staleIds } } });
    }

    if (embedResult && newChunks.length > 0) {
      for (let i = 0; i < newChunks.length; i++) {
        const chunk = newChunks[i]!;
        const vector = embedResult.embeddings[i];
        if (!vector) continue;
        const blockId = chunk.blockIds[0] ?? null;
        const id = createId();
        const vectorLiteral = toVectorLiteral(vector);

        // Parameterized insert; the vector array literal is bound and cast to
        // ::vector server-side. ON CONFLICT keeps the unique (doc, block, idx)
        // constraint satisfied if a row for that slot already exists.
        await tx.$executeRaw`
          INSERT INTO "embedding"
            ("id", "documentId", "blockId", "chunkIndex", "content", "contentHash", "model", "embedding", "createdAt")
          VALUES (
            ${id},
            ${documentId},
            ${blockId},
            ${chunk.index},
            ${chunk.content},
            ${chunk.hash},
            ${EMBED_MODEL_ID},
            ${vectorLiteral}::vector,
            now()
          )
          ON CONFLICT ("documentId", "blockId", "chunkIndex")
          DO UPDATE SET
            "content" = EXCLUDED."content",
            "contentHash" = EXCLUDED."contentHash",
            "model" = EXCLUDED."model",
            "embedding" = EXCLUDED."embedding"
        `;
      }
    }
  });

  return {
    documentId,
    embedded: embedResult ? newChunks.length : 0,
    reused,
    removed: staleIds.length,
    skipped: false,
  };
}

/**
 * Fire-and-forget wrapper safe to call from the M2 save path (and later from
 * collab compaction). Never throws into the caller: any failure — missing key,
 * transient OpenRouter error, DB hiccup — is swallowed and logged, so a failed
 * embed never breaks a document save. Returns the result (or a skipped marker)
 * for callers that do want to await it (tests, jobs).
 */
export async function embedDocumentSafe(
  prisma: PrismaClient,
  documentId: string,
): Promise<EmbedDocumentResult> {
  try {
    return await embedDocument(prisma, documentId);
  } catch (err) {
    // Intentionally non-fatal. M6 replaces this inline call with a BullMQ job
    // that has its own retry/backoff; until then we degrade silently.
    console.error(`[ai] embedDocument failed for ${documentId}:`, err);
    return emptyResult(documentId, false);
  }
}

/**
 * Minimal collision-resistant id generator matching Prisma's cuid-ish ids well
 * enough for a raw INSERT (the column is just a unique string PK). Avoids
 * pulling a cuid dependency into this package.
 */
function createId(): string {
  const rand = Math.random().toString(36).slice(2, 12);
  const time = Date.now().toString(36);
  return `emb_${time}${rand}`;
}
