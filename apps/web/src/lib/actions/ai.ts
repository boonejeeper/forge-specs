"use server";

import { prisma } from "@forgespecs/db";
import {
  withPermission,
  diffSuggestion,
  type Scope,
} from "@forgespecs/core";

import "@/lib/auth/rbac"; // installs the RBAC provider on import
import { createSuggestion } from "./suggestions";

/**
 * AI → Suggestion bridge actions (M6).
 *
 * BOTH chat `proposeEdit` (confirmed in the panel) and the selection
 * "Refine with AI" flow turn an AI-produced revision into a TRACK-CHANGES
 * SUGGESTION via the M5 shared path: we build the proposed BlockNote body
 * against the document's authoritative `contentJSON`, compute the delta with
 * core `diffSuggestion`, and call `createSuggestion`. The AI never writes
 * Postgres-of-record directly — it produces a reviewable suggestion a human
 * approves, preserving audit + collab convergence.
 *
 * The base is read SERVER-SIDE from the projected contentJSON so the delta is
 * computed against the source of truth, not a stale client copy. (If a live Yjs
 * room has drifted, suggestion acceptance re-validates against the live body —
 * see resolveSuggestion.)
 *
 * RBAC: gated on `suggestion.create` (same as a human propose).
 */

type BlockNoteBlock = Record<string, unknown>;

/** Replace the first text run of `blockId`, or append a new paragraph block. */
function buildProposed(
  base: BlockNoteBlock[],
  proposedText: string,
  blockId?: string,
): BlockNoteBlock[] {
  const clone = structuredClone(base);
  if (blockId) {
    const walk = (blocks: BlockNoteBlock[]): boolean => {
      for (const b of blocks) {
        if (b.id === blockId) {
          b.content = [{ type: "text", text: proposedText, styles: {} }];
          return true;
        }
        const children = b.children as BlockNoteBlock[] | undefined;
        if (Array.isArray(children) && walk(children)) return true;
      }
      return false;
    };
    if (walk(clone)) return clone;
  }
  // No target block (or not found) → append a new paragraph.
  clone.push({
    type: "paragraph",
    content: [{ type: "text", text: proposedText, styles: {} }],
  });
  return clone;
}

const _proposeEditSuggestion = withPermission(
  (input: {
    documentId: string;
    proposedText: string;
    blockId?: string;
    rationale?: string | null;
    scope: Scope;
  }) => input.scope,
  "suggestion.create",
  async (
    _actor,
    input,
  ): Promise<{ id: string; status: string }> => {
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: input.documentId },
      select: { contentJSON: true },
    });
    const base = Array.isArray(doc.contentJSON)
      ? (doc.contentJSON as BlockNoteBlock[])
      : [];
    const proposed = buildProposed(base, input.proposedText, input.blockId);
    const patch = diffSuggestion(base, proposed);
    if (!patch) {
      throw new Error("Proposed edit produced no change.");
    }
    return createSuggestion({
      documentId: input.documentId,
      patch,
      rationale: input.rationale ?? "Proposed by AI",
      baseContent: base,
      scope: input.scope,
    });
  },
);

/**
 * Turn a confirmed AI `proposeEdit` (or a streamed refine result) into a
 * Suggestion. Called by the chat panel's confirmation card and the selection
 * "Refine with AI" toolbar.
 */
export async function proposeEditSuggestion(input: {
  documentId: string;
  proposedText: string;
  blockId?: string;
  rationale?: string | null;
  scope: Scope;
}): Promise<{ id: string; status: string }> {
  return _proposeEditSuggestion(input);
}
