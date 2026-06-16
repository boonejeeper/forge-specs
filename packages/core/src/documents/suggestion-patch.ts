/**
 * Suggestion patch logic — track-changes over BlockNote document JSON.
 *
 * A Suggestion captures a proposed edit as a `jsondiffpatch` *delta* (stored in
 * `Suggestion.patch`, a `Json` column) computed between the document body the
 * author saw (`base`) and their proposed body (`proposed`). The delta — not the
 * full proposed doc — is what we persist: it's compact, it shows the reviewer
 * exactly what changed, and it can be applied onto the *current* live doc even
 * if it drifted a little since the suggestion was made.
 *
 * Accept = apply the delta to the live document (through the editor/Yjs path the
 * action wires up) + flip status to ACCEPTED + audit. Reject = discard.
 *
 * This module is pure and dependency-light (only `jsondiffpatch`), so it is the
 * shared, fully unit-tested core that BOTH a human "propose edit" action AND
 * M6's AI-refine flow call to produce/validate/apply a Suggestion. Keeping the
 * algorithm here (not in the web action) is what makes the suggestion path
 * reusable across humans and agents per the plan.
 */
import { create, type Delta, type Options } from "jsondiffpatch";

import type { BlockNoteBlock } from "./block-content";

/**
 * BlockNote document = an array of blocks. We diff arrays of objects by their
 * stable `id`, so reordering/insertion/deletion produces a minimal, legible
 * delta instead of a positional churn. This matches how the Block projection is
 * keyed and how the editor identifies blocks.
 */
const diffConfig: Options = {
  objectHash: (obj: object): string | undefined => {
    if (obj && typeof obj === "object" && "id" in obj) {
      const id = (obj as { id?: unknown }).id;
      if (typeof id === "string") return id;
    }
    return undefined;
  },
  // Detect block moves within the array (cheaper, clearer deltas).
  arrays: { detectMove: true, includeValueOnMove: false },
  // No char-level text diffing: prose lives in BlockNote inline-content arrays
  // and whole-value replacement keeps deltas deterministic and dependency-free
  // (the optional diff-match-patch text differ is a render-time concern). The
  // default `create` already omits text diffing unless explicitly configured.
};

const differ = create(diffConfig);

export type SuggestionPatch = Delta;

export type BlockNoteDoc = BlockNoteBlock[];

/** Normalize a possibly-null document body to an array. */
function asDoc(value: unknown): BlockNoteDoc {
  return Array.isArray(value) ? (value as BlockNoteDoc) : [];
}

/**
 * Compute the suggestion delta between the base document the author edited and
 * their proposed version. Returns `undefined` when there is no change (callers
 * should reject empty suggestions).
 */
export function diffSuggestion(base: unknown, proposed: unknown): SuggestionPatch | undefined {
  return differ.diff(asDoc(base), asDoc(proposed));
}

/**
 * Apply a suggestion delta to a document body, returning a NEW document (the
 * input is cloned first — jsondiffpatch mutates in place otherwise). Throws if
 * the patch is structurally invalid for the target.
 */
export function applySuggestion(target: unknown, patch: SuggestionPatch): BlockNoteDoc {
  const clone = structuredClone(asDoc(target));
  const result = differ.patch(clone, patch);
  return asDoc(result);
}

/**
 * Reverse-apply a delta (undo). Useful for "unaccept" / preview toggling and for
 * M8 fork-forward semantics. Returns the document with the change undone.
 */
export function revertSuggestion(target: unknown, patch: SuggestionPatch): BlockNoteDoc {
  const clone = structuredClone(asDoc(target));
  const result = differ.unpatch(clone, patch);
  return asDoc(result);
}

/**
 * Validate that a delta both looks like a jsondiffpatch delta AND cleanly
 * applies to the given target. The action calls this before persisting (author
 * side) and before accepting (reviewer side, against the *live* doc) so a stale
 * suggestion that no longer applies is surfaced instead of corrupting the body.
 */
export type PatchValidation =
  | { ok: true; result: BlockNoteDoc }
  | { ok: false; reason: string };

export function validateSuggestion(
  target: unknown,
  patch: unknown,
): PatchValidation {
  if (!isDelta(patch)) {
    return { ok: false, reason: "Suggestion patch is not a valid delta." };
  }
  try {
    const result = applySuggestion(target, patch as SuggestionPatch);
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? `Suggestion no longer applies cleanly: ${err.message}`
          : "Suggestion no longer applies cleanly.",
    };
  }
}

/**
 * A jsondiffpatch delta is a plain object (never an array at the top level for a
 * document-array diff — array deltas are objects keyed by index with an `_t`
 * marker). A no-op is `undefined`. This is a cheap shape guard, not a full
 * schema check; `validateSuggestion` does the real "does it apply" check.
 */
export function isDelta(value: unknown): value is SuggestionPatch {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/**
 * Summarize a delta into block-level change counts for the reviewer preview
 * header ("+2 added · 1 removed · 3 modified"). Operates on the array delta of
 * the document (top-level blocks); nested prose edits count as a modify.
 */
export interface SuggestionSummary {
  added: number;
  removed: number;
  modified: number;
  moved: number;
}

export function summarizeSuggestion(patch: unknown): SuggestionSummary {
  const empty: SuggestionSummary = { added: 0, removed: 0, modified: 0, moved: 0 };
  if (!isDelta(patch)) return empty;

  const delta = patch as Record<string, unknown>;
  // Array delta marker. Without it the top-level isn't an array diff (unexpected
  // for a document body) — treat every key as a modify.
  const isArrayDelta = delta._t === "a";

  let added = 0;
  let removed = 0;
  let modified = 0;
  let moved = 0;

  for (const key of Object.keys(delta)) {
    if (key === "_t") continue;
    const entry = delta[key];
    if (isArrayDelta && key.startsWith("_")) {
      // Removed (["",0,0]) or moved (["",index,3]) entries are keyed "_<index>".
      if (Array.isArray(entry) && entry.length === 3 && entry[2] === 3) {
        moved += 1;
      } else {
        removed += 1;
      }
      continue;
    }
    if (Array.isArray(entry)) {
      // [newValue] = add; [old,new] = modify (non-array deltas at index level).
      if (entry.length === 1) added += 1;
      else modified += 1;
    } else {
      // Nested object delta → an in-place modification of that block.
      modified += 1;
    }
  }

  return { added, removed, modified, moved };
}
