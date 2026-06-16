"use server";

import { revalidatePath } from "next/cache";
import { prisma, ActivityType, type Prisma } from "@forgespecs/db";
import {
  withPermission,
  logActivity,
  diffDocuments,
  restoreVersion as coreRestoreVersion,
  type DocumentDiff,
  type Scope,
} from "@forgespecs/core";

import "@/lib/auth/rbac"; // installs the RBAC provider on import

/**
 * Versioning Server Actions (M8).
 *
 * - getVersionDiff: compute the block-level + inline diff between two snapshots
 *   ON DEMAND (we store full snapshots, not diff chains). Requires `doc.read`.
 * - restoreVersion: FORK-FORWARD restore. Requires `doc.edit`. Returns the
 *   target snapshot content so the connected editor applies it through
 *   BlockNote → Yjs (the same convergent path accept-suggestion uses); the live
 *   document projection is also updated server-side so offline docs reconcile.
 *
 * Every mutation/read goes through `withPermission` — the single auth chokepoint.
 */

const _getVersionDiff = withPermission(
  (input: { documentId: string; aNum: number; bNum: number; scope: Scope }) =>
    input.scope,
  "doc.read",
  async (
    _actor,
    input,
  ): Promise<DocumentDiff> => {
    const [a, b] = await Promise.all([
      prisma.documentVersion.findUnique({
        where: {
          documentId_versionNum: {
            documentId: input.documentId,
            versionNum: input.aNum,
          },
        },
        select: { contentJSON: true },
      }),
      prisma.documentVersion.findUnique({
        where: {
          documentId_versionNum: {
            documentId: input.documentId,
            versionNum: input.bNum,
          },
        },
        select: { contentJSON: true },
      }),
    ]);
    return diffDocuments(a?.contentJSON ?? [], b?.contentJSON ?? []);
  },
);

const _restoreVersion = withPermission(
  (input: { documentId: string; versionNum: number; scope: Scope }) =>
    input.scope,
  "doc.edit",
  async (
    actor,
    input,
  ): Promise<{
    id: string;
    versionNum: number;
    restoredFrom: number;
    /** The restored body for the editor to apply through Yjs (converges). */
    content: unknown;
  }> => {
    const result = await prisma.$transaction(async (tx) => {
      const restored = await coreRestoreVersion(
        {
          documentId: input.documentId,
          versionNum: input.versionNum,
          authorId: actor.userId,
        },
        tx,
      );
      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          // Audit hardening (M11): restores are security-relevant — use the
          // dedicated VERSION_RESTORED type so the audit log distinguishes a
          // fork-forward restore from an ordinary version checkpoint.
          type: ActivityType.VERSION_RESTORED,
          entityType: "document",
          entityId: input.documentId,
          data: {
            versionNum: restored.versionNum,
            restoredFrom: restored.restoredFrom,
            label: `Restored from v${restored.restoredFrom}`,
          } as Prisma.InputJsonValue,
        },
        tx,
      );
      return restored;
    });

    revalidatePath("/", "layout");

    return {
      id: result.id,
      versionNum: result.versionNum,
      restoredFrom: result.restoredFrom,
      content: result.content,
    };
  },
);

// ── exported Server Actions ────────────────────────────────────────────────

/**
 * Compute the on-demand diff between two version snapshots. Requires `doc.read`.
 */
export async function getVersionDiff(input: {
  documentId: string;
  aNum: number;
  bNum: number;
  scope: Scope;
}): Promise<DocumentDiff> {
  return _getVersionDiff(input);
}

/**
 * Fork-forward restore the document to an earlier version. Requires `doc.edit`.
 * Returns the restored content for the editor to apply through Yjs.
 */
export async function restoreVersion(input: {
  documentId: string;
  versionNum: number;
  scope: Scope;
}): Promise<{
  id: string;
  versionNum: number;
  restoredFrom: number;
  content: unknown;
}> {
  return _restoreVersion(input);
}
