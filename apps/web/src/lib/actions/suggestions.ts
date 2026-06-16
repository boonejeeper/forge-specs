"use server";

import {
  prisma,
  ActivityType,
  NotificationType,
  SuggestionStatus,
  type Prisma,
} from "@forgespecs/db";
import {
  withPermission,
  logActivity,
  createNotification,
  validateSuggestion,
  isDelta,
  type Scope,
} from "@forgespecs/core";

import "@/lib/auth/rbac";

/**
 * Suggestion (track-changes) Server Actions (M5).
 *
 * A Suggestion is a `jsondiffpatch` delta over the BlockNote document JSON,
 * produced by the core `diffSuggestion` helper on the client (base body → the
 * author's proposed body). We persist the DELTA (compact, legible, re-appliable)
 * — see `Suggestion.patch`.
 *
 * APPLY-TO-LIVE-DOC (the three-sources-of-truth rule): the document body is a
 * Yjs CRDT owned by the collab process. The web server must NOT write the CRDT
 * directly while a room is live (that would bypass collab + lose audit/undo). So
 * acceptance here flips status + audits + notifies, and returns the validated
 * resulting document JSON; the connected editor applies the change THROUGH
 * BlockNote/Yjs (the same path a human edit takes) so it converges for everyone.
 * For offline docs (no live room), the next compaction reconciles from the
 * editor's applied state. This same path is what M6's AI-refine reuses: an agent
 * produces a delta via `diffSuggestion` and calls `createSuggestion`.
 *
 * Every mutation goes through `withPermission`. Note `Suggestion.status` uses the
 * schema's enum values PENDING/ACCEPTED/REJECTED (PENDING == "open").
 */

export interface SuggestionResult {
  id: string;
  status: SuggestionStatus;
}

const _createSuggestion = withPermission(
  (input: {
    documentId: string;
    patch: unknown;
    rationale?: string | null;
    /** Current body the delta was computed against, for a sanity check. */
    baseContent?: unknown;
    scope: Scope;
  }) => input.scope,
  "suggestion.create",
  async (actor, input): Promise<SuggestionResult> => {
    if (!isDelta(input.patch)) {
      throw new Error("Suggestion is empty or not a valid patch.");
    }
    // If the author supplied the base they diffed against, verify the delta
    // applies cleanly to it (cheap guard against a malformed/empty proposal).
    if (input.baseContent !== undefined) {
      const check = validateSuggestion(input.baseContent, input.patch);
      if (!check.ok) throw new Error(check.reason);
    }

    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.suggestion.create({
        data: {
          documentId: input.documentId,
          authorId: actor.userId,
          patch: input.patch as Prisma.InputJsonValue,
          rationale: input.rationale?.trim() || null,
          status: SuggestionStatus.PENDING,
        },
        select: { id: true, status: true },
      });
      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.SUGGESTION_CREATED,
          entityType: "document",
          entityId: input.documentId,
          data: { suggestionId: s.id },
        },
        tx,
      );
      return s;
    });

    return created;
  },
);

const _resolveSuggestion = withPermission(
  (input: {
    suggestionId: string;
    accept: boolean;
    /** The CURRENT live document body, to validate the patch still applies. */
    liveContent?: unknown;
    scope: Scope;
    docTitle?: string;
    link?: string | null;
  }) => input.scope,
  "suggestion.resolve",
  async (
    actor,
    input,
  ): Promise<{
    id: string;
    status: SuggestionStatus;
    /** When accepted, the resulting document body the editor should apply. */
    applied?: unknown;
  }> => {
    const suggestion = await prisma.suggestion.findUniqueOrThrow({
      where: { id: input.suggestionId },
      select: {
        id: true,
        documentId: true,
        authorId: true,
        patch: true,
        status: true,
      },
    });
    if (suggestion.status !== SuggestionStatus.PENDING) {
      throw new Error(`Suggestion is already ${suggestion.status}.`);
    }

    let applied: unknown;

    if (input.accept) {
      // Validate the delta still applies to the live body before accepting. The
      // client passes the live content (from the editor); fall back to the
      // server's projected contentJSON if absent (offline doc).
      let base = input.liveContent;
      if (base === undefined) {
        const doc = await prisma.document.findUniqueOrThrow({
          where: { id: suggestion.documentId },
          select: { contentJSON: true },
        });
        base = doc.contentJSON ?? [];
      }
      const check = validateSuggestion(base, suggestion.patch);
      if (!check.ok) {
        throw new Error(check.reason);
      }
      applied = check.result;
    }

    const status = input.accept
      ? SuggestionStatus.ACCEPTED
      : SuggestionStatus.REJECTED;

    await prisma.$transaction(async (tx) => {
      await tx.suggestion.update({
        where: { id: suggestion.id },
        data: { status },
      });
      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.SUGGESTION_RESOLVED,
          entityType: "document",
          entityId: suggestion.documentId,
          data: { suggestionId: suggestion.id, status },
        },
        tx,
      );
      // Notify the suggestion author of the decision (not self-notify).
      if (suggestion.authorId && suggestion.authorId !== actor.userId) {
        await createNotification(
          {
            recipientId: suggestion.authorId,
            type: NotificationType.SUGGESTION,
            title: input.accept
              ? `Your suggestion was accepted`
              : `Your suggestion was rejected`,
            body: input.docTitle ? `on “${input.docTitle}”` : null,
            link: input.link ?? null,
          },
          tx,
        );
      }
    });

    return { id: suggestion.id, status, applied };
  },
);

// ── exported Server Actions ────────────────────────────────────────────────

/**
 * Create a suggestion from a jsondiffpatch delta. Requires `suggestion.create`.
 * Reused by M6 AI-refine: an agent computes the delta via core `diffSuggestion`
 * and calls this exact action.
 */
export async function createSuggestion(input: {
  documentId: string;
  patch: unknown;
  rationale?: string | null;
  baseContent?: unknown;
  scope: Scope;
}): Promise<SuggestionResult> {
  return _createSuggestion(input);
}

/**
 * Accept (apply) or reject a suggestion. Requires `suggestion.resolve`. On
 * accept, returns the resulting document body for the editor to apply through
 * Yjs (converging for all collaborators).
 */
export async function resolveSuggestion(input: {
  suggestionId: string;
  accept: boolean;
  liveContent?: unknown;
  scope: Scope;
  docTitle?: string;
  link?: string | null;
}): Promise<{ id: string; status: SuggestionStatus; applied?: unknown }> {
  return _resolveSuggestion(input);
}
