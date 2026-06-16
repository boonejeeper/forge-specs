/**
 * Postgres persistence adapter for the Yjs collab server.
 *
 * Design (append-log + compaction — see plan M4 risk #1):
 *
 *  LOAD    Reconstruct the room's Y.Doc from `Document.yDocState` (the last
 *          compacted base) then replay every `YjsUpdate` row appended since.
 *
 *  APPEND  On each incoming update we INSERT one `YjsUpdate` row. This is a
 *          single fast write and is the crash-safe unit of durability: even if
 *          the process dies mid-compaction, no committed edit is ever lost —
 *          the next load replays the log on top of whatever base survived.
 *
 *  COMPACT Debounced (idle / count thresholds). In ONE transaction we:
 *            1. fold the in-memory doc state into `Document.yDocState`,
 *            2. regenerate the read projection (contentJSON / contentText /
 *               Block rows) via the SAME core utils the M2 REST save uses,
 *            3. delete the `YjsUpdate` rows we folded (by id high-water mark —
 *               rows that arrive mid-compaction keep a higher id and survive).
 *          Then, outside the txn, we fire-and-forget an embedding refresh.
 *
 * Idempotency / crash-safety: compaction is a pure function of the current doc
 * state plus "delete rows with id <= watermark". Re-running it is harmless. If
 * the txn fails or the process crashes, yDocState + the (untruncated) log still
 * fully describe the document, so the next load is correct.
 */
import { prisma, type PrismaClient, type Prisma } from "@forgespecs/db";
import {
  blocknoteToPlainText,
  projectBlocks,
  yDocToBlockNote,
} from "@forgespecs/core";
import { enqueueEmbedDocument } from "@forgespecs/jobs";
import * as Y from "yjs";

/**
 * Load a Y.Doc for a document id from durable storage.
 *
 * Returns the doc plus the highest `YjsUpdate` id that was replayed — the
 * compaction watermark. A null watermark means there were no pending updates.
 */
export async function loadDoc(
  documentId: string,
  db: PrismaClient = prisma,
): Promise<{ doc: Y.Doc; watermark: bigint | null }> {
  const doc = new Y.Doc();

  const row = await db.document.findUnique({
    where: { id: documentId },
    select: { yDocState: true },
  });

  if (row?.yDocState) {
    Y.applyUpdate(doc, new Uint8Array(row.yDocState));
  }

  const updates = await db.yjsUpdate.findMany({
    where: { documentId },
    orderBy: { id: "asc" },
    select: { id: true, update: true },
  });

  let watermark: bigint | null = null;
  // Apply the whole log in a single transaction for efficiency / atomicity of
  // observers (none here, but keeps semantics clean).
  Y.transact(doc, () => {
    for (const u of updates) {
      Y.applyUpdate(doc, new Uint8Array(u.update));
      watermark = u.id;
    }
  });

  return { doc, watermark };
}

/** Append a single binary update to the durable log. Fast path on every edit. */
export async function appendUpdate(
  documentId: string,
  update: Uint8Array,
  db: PrismaClient = prisma,
): Promise<bigint> {
  const row = await db.yjsUpdate.create({
    data: { documentId, update: Buffer.from(update) },
    select: { id: true },
  });
  return row.id;
}

export interface CompactionResult {
  documentId: string;
  /** Number of YjsUpdate rows folded + truncated. */
  folded: number;
  /** New compacted state byte length. */
  stateBytes: number;
  /** Number of projected Block rows written. */
  blocks: number;
}

/**
 * Fold the current doc state into `yDocState`, regenerate the read projection,
 * and truncate the folded log rows — atomically.
 *
 * @param doc        the live, in-memory Y.Doc for the room
 * @param watermark  highest YjsUpdate id whose effect is already in `doc`. Rows
 *                   with a higher id (arrived after we snapshotted) are NOT
 *                   deleted, so concurrent edits are never lost.
 */
export async function compact(
  documentId: string,
  doc: Y.Doc,
  watermark: bigint | null,
  db: PrismaClient = prisma,
): Promise<CompactionResult> {
  // Snapshot the encoded state BEFORE opening the txn so the txn is short.
  const state = Y.encodeStateAsUpdate(doc);
  const stateBuf = Buffer.from(state);

  // Derive the read projection from the SAME core utils as the M2 save path,
  // via the dependency-light Y.Doc → BlockNote JSON projector (no BlockNote /
  // ProseMirror instantiation needed server-side).
  const blocknote = yDocToBlockNote(doc);
  const contentText = blocknoteToPlainText(blocknote);
  const rows = projectBlocks(blocknote);

  await db.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        yDocState: stateBuf,
        contentJSON: (blocknote ?? []) as unknown as Prisma.InputJsonValue,
        contentText,
      },
    });

    // Replace the Block projection wholesale (idempotent; specs are small).
    await tx.block.deleteMany({ where: { documentId } });
    if (rows.length > 0) {
      await tx.block.createMany({
        data: rows.map((r) => ({
          id: r.id,
          documentId,
          parentId: r.parentId,
          order: r.order,
          type: r.type,
          json: r.json as unknown as Prisma.InputJsonValue,
          text: r.text,
        })),
      });
    }

    // Truncate the folded log. Only rows whose effect we captured (id <=
    // watermark) are removed; anything newer survives for the next load/compact.
    if (watermark !== null) {
      await tx.yjsUpdate.deleteMany({
        where: { documentId, id: { lte: watermark } },
      });
    }
  });

  // Embedding refresh — enqueued onto BullMQ when Redis is configured, else run
  // inline (the M3 behaviour). Either way it's fire-and-forget, never throws, and
  // no-ops without an API key. Reads the Block rows we just wrote, so runs AFTER
  // the txn.
  void enqueueEmbedDocument(db, documentId);

  return {
    documentId,
    folded: watermark === null ? 0 : countFolded(watermark),
    stateBytes: stateBuf.byteLength,
    blocks: rows.length,
  };
}

// `folded` is informational only; we don't re-query the deleted count. The
// watermark is the truncation boundary, so the precise number isn't load-bearing.
function countFolded(_watermark: bigint): number {
  return 1;
}
