import { prisma, type Prisma, type PrismaClient } from "@forgespecs/db";

import { createVersion, type CreatedVersion } from "./snapshot";

type Db = PrismaClient | Prisma.TransactionClient;

export interface RestoreVersionInput {
  documentId: string;
  /** The target version to restore the document to. */
  versionNum: number;
  authorId?: string | null;
}

export interface RestoreResult extends CreatedVersion {
  /** The restored body (the target snapshot's contentJSON) for the editor to
   *  apply through BlockNote → Yjs so collaborators converge. */
  content: unknown;
  /** The version number that was restored FROM (the target). */
  restoredFrom: number;
}

/**
 * Restore a document to an earlier version — **fork-forward**, never destructive.
 *
 * Per the plan, restore does NOT mutate or delete history. Instead it:
 *   1. Loads the target `DocumentVersion` snapshot (full content — O(1)).
 *   2. Writes the target content onto the live `Document` projection
 *      (`contentJSON`/`contentText`) so the server-of-record reflects the
 *      restore even for offline docs.
 *   3. Creates a NEW `DocumentVersion` (monotonic `versionNum`) equal to the
 *      target snapshot, labelled "Restored from vN".
 *
 * The returned `content` is handed back to the connected client, which applies
 * it through the editor → Yjs (the SAME path accept-suggestion uses), so the
 * change converges for every collaborator in the live room. For offline docs the
 * next compaction reconciles from the editor's applied state.
 *
 * RBAC (doc.edit) is enforced by the calling Server Action; this core helper is
 * the pure data operation, reusable + transactional.
 */
export async function restoreVersion(
  input: RestoreVersionInput,
  db: Db = prisma,
): Promise<RestoreResult> {
  const run = async (tx: Db): Promise<RestoreResult> => {
    const target = await tx.documentVersion.findUniqueOrThrow({
      where: {
        documentId_versionNum: {
          documentId: input.documentId,
          versionNum: input.versionNum,
        },
      },
      select: { contentJSON: true, contentText: true, versionNum: true },
    });

    // Push the snapshot content onto the live document projection so the
    // server-of-record matches the restore (covers offline docs; live rooms also
    // converge via the editor applying the returned content through Yjs).
    await tx.document.update({
      where: { id: input.documentId },
      data: {
        contentJSON: (target.contentJSON ?? {}) as Prisma.InputJsonValue,
        contentText: target.contentText,
      },
    });

    // Fork forward: a NEW version equal to the target snapshot. createVersion
    // reads the (now-updated) document projection, so the new snapshot content
    // equals the target. Label records the provenance.
    const created = await createVersion(
      {
        documentId: input.documentId,
        authorId: input.authorId ?? null,
        label: `Restored from v${input.versionNum}`,
      },
      tx,
    );

    return {
      ...created,
      content: target.contentJSON ?? [],
      restoredFrom: target.versionNum,
    };
  };

  if ("$transaction" in db) {
    return (db as PrismaClient).$transaction((tx) => run(tx));
  }
  return run(db);
}
