import { prisma, type Prisma, type PrismaClient } from "@forgespecs/db";

/**
 * A Prisma client or interactive-transaction client. Snapshotting may run on
 * its own or inside a larger transaction (e.g. alongside a status change), so
 * callers can pass the tx handle.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateVersionInput {
  documentId: string;
  authorId?: string | null;
  /** Optional human label / changelog note for the snapshot. */
  label?: string | null;
}

export interface CreatedVersion {
  id: string;
  versionNum: number;
  documentId: string;
}

/**
 * Has the document's current content changed since its most recent snapshot?
 * Used to keep `createVersion` idempotent-ish on automatic triggers (status
 * transitions, explicit save) — we don't burn a version number when nothing
 * changed since the last checkpoint. Compares `contentText` (cheap, exact for
 * our purposes) and falls back to "changed" when there is no prior version.
 */
export async function hasChangesSinceLastVersion(
  documentId: string,
  db: Db = prisma,
): Promise<boolean> {
  const [doc, latest] = await Promise.all([
    db.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { contentText: true },
    }),
    db.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNum: "desc" },
      select: { contentText: true },
    }),
  ]);
  if (!latest) return true;
  return doc.contentText !== latest.contentText;
}

/**
 * Snapshot the current state of a document as a new immutable
 * `DocumentVersion`.
 *
 * Per the plan we store **full snapshots** (not diff chains) so restore is O(1)
 * and corruption-immune. `contentJSON`/`contentText` may be minimal/empty at M1
 * because the rich editor (and thus real block content) arrives in M2 — we
 * snapshot whatever projection currently exists on the Document row.
 *
 * Monotonic `versionNum` is derived from the document's `currentVersion`
 * counter, which we bump in the same transaction to keep them in lockstep.
 *
 * @param db  optional Prisma/transaction handle (defaults to the singleton)
 */
export async function createVersion(
  input: CreateVersionInput,
  db: Db = prisma,
): Promise<CreatedVersion> {
  const run = async (tx: Db): Promise<CreatedVersion> => {
    const doc = await tx.document.findUniqueOrThrow({
      where: { id: input.documentId },
      select: {
        id: true,
        currentVersion: true,
        contentJSON: true,
        contentText: true,
      },
    });

    const versionNum = doc.currentVersion + 1;

    const version = await tx.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNum,
        contentJSON: doc.contentJSON ?? {},
        contentText: doc.contentText,
        summary: input.label ?? null,
        authorId: input.authorId ?? null,
      },
      select: { id: true, versionNum: true, documentId: true },
    });

    await tx.document.update({
      where: { id: doc.id },
      data: { currentVersion: versionNum },
    });

    return version;
  };

  // If we were handed a transaction client, reuse it; otherwise open one so the
  // snapshot + counter bump are atomic.
  if ("$transaction" in db) {
    return (db as PrismaClient).$transaction((tx) => run(tx));
  }
  return run(db);
}
