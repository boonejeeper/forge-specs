/**
 * Versioning diff engine — pure, dependency-light, fully unit-tested.
 *
 * Produces a *renderable diff model* between two BlockNote document JSON
 * snapshots (the `contentJSON` stored on `DocumentVersion`). The model is a flat,
 * ordered list of block-level hunks (added / removed / moved / changed /
 * unchanged), and for `changed` blocks a word-level inline diff over the block's
 * flattened text. The UI (M8 history routes) renders this model directly without
 * touching jsondiffpatch or BlockNote internals.
 *
 * Two layers:
 *   1. Block-structural diff — `jsondiffpatch` keyed by block `id` (same config
 *      as the suggestion patch) gives us added/removed/moved precisely; we walk
 *      the two block arrays by id to classify and pair survivors.
 *   2. Prose/text diff — the `diff` package (`diffWords`) on the flattened text
 *      of paired blocks for inline word-level highlighting.
 *
 * Kept in `packages/core` (process-agnostic) so it can run server-side
 * (getVersionDiff action computing on demand) or, if ever needed, client-side.
 */
import { diffWords } from "diff";

import { blockText, type BlockNoteBlock } from "../documents/block-content";

export type DiffOp = "added" | "removed" | "moved" | "changed" | "unchanged";

/** A run of inline text annotated as added / removed / unchanged. */
export interface InlineSegment {
  type: "added" | "removed" | "unchanged";
  value: string;
}

/** One block-level hunk in the renderable diff. */
export interface BlockDiffHunk {
  /** Stable block id (from BlockNote). Synthetic for id-less blocks. */
  id: string;
  op: DiffOp;
  /** Block type (paragraph / heading / codeBlock / mermaid / …). */
  blockType: string;
  /** Flattened text in version A (the "before"); empty for pure additions. */
  before: string;
  /** Flattened text in version B (the "after"); empty for pure removals. */
  after: string;
  /** Word-level inline segments — only populated for `changed` hunks. */
  inline?: InlineSegment[];
  /** For `moved` blocks: sibling index in A and B (debug / UI affordance). */
  fromIndex?: number;
  toIndex?: number;
}

export interface DocumentDiff {
  hunks: BlockDiffHunk[];
  stats: DiffStats;
}

export interface DiffStats {
  added: number;
  removed: number;
  moved: number;
  changed: number;
  unchanged: number;
}

/** Normalize a possibly-null document body to a flat top-level block array. */
function asBlocks(value: unknown): BlockNoteBlock[] {
  return Array.isArray(value) ? (value as BlockNoteBlock[]) : [];
}

function blockId(block: BlockNoteBlock, fallbackIndex: number): string {
  return typeof block.id === "string" && block.id.length > 0
    ? block.id
    : `__pos_${fallbackIndex}`;
}

function blockType(block: BlockNoteBlock): string {
  return typeof block.type === "string" ? block.type : "paragraph";
}

/**
 * Flatten a block (including nested children) to plaintext so a structural move
 * of a container with children still diffs meaningfully. Children are joined
 * with newlines, mirroring `blocknoteToPlainText`'s document-order flattening.
 */
function flatBlockText(block: BlockNoteBlock): string {
  const lines: string[] = [];
  const own = blockText(block);
  if (own.length > 0) lines.push(own);
  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      const childText = flatBlockText(child);
      if (childText.length > 0) lines.push(childText);
    }
  }
  return lines.join("\n");
}

/** Compute word-level inline segments between two block texts. */
export function inlineWordDiff(before: string, after: string): InlineSegment[] {
  const parts = diffWords(before, after);
  return parts.map((p) => ({
    type: p.added ? "added" : p.removed ? "removed" : "unchanged",
    value: p.value,
  }));
}

/**
 * Compute the renderable diff between two BlockNote document snapshots.
 *
 * Algorithm (top-level blocks only — nested content is folded into a block's
 * flattened text, matching the snapshot/projection model):
 *   - Index both sides by stable block id.
 *   - An id present only in B → `added`; only in A → `removed`.
 *   - An id in both: if its sibling position changed → `moved`; if its flattened
 *     text changed → `changed` (with inline word diff); otherwise `unchanged`.
 *     (A block can be both moved and changed; we classify text changes as
 *     `changed` since that is the higher-signal render, and surface position via
 *     fromIndex/toIndex.)
 *   - Output is ordered to follow version B (the "after"), with removed blocks
 *     emitted at their former position so the side-by-side reads naturally.
 */
export function diffDocuments(a: unknown, b: unknown): DocumentDiff {
  const aBlocks = asBlocks(a);
  const bBlocks = asBlocks(b);

  const aById = new Map<string, { block: BlockNoteBlock; index: number }>();
  aBlocks.forEach((block, index) => {
    aById.set(blockId(block, index), { block, index });
  });
  const bById = new Map<string, { block: BlockNoteBlock; index: number }>();
  bBlocks.forEach((block, index) => {
    bById.set(blockId(block, index), { block, index });
  });

  const hunks: BlockDiffHunk[] = [];
  const stats: DiffStats = {
    added: 0,
    removed: 0,
    moved: 0,
    changed: 0,
    unchanged: 0,
  };

  // Track which removed (A-only) blocks we still owe output for, so we can
  // interleave them near their original position rather than dumping at the end.
  const emittedFromA = new Set<string>();

  const emitRemovedBefore = (bIndex: number): void => {
    // Emit any A-only block whose original index sits before this B index and
    // hasn't been emitted yet — keeps deletions roughly in place.
    aBlocks.forEach((block, index) => {
      const id = blockId(block, index);
      if (bById.has(id) || emittedFromA.has(id)) return;
      if (index <= bIndex) {
        emittedFromA.add(id);
        hunks.push({
          id,
          op: "removed",
          blockType: blockType(block),
          before: flatBlockText(block),
          after: "",
          fromIndex: index,
        });
        stats.removed += 1;
      }
    });
  };

  bBlocks.forEach((bBlock, bIndex) => {
    const id = blockId(bBlock, bIndex);
    emitRemovedBefore(bIndex);

    const inA = aById.get(id);
    if (!inA) {
      hunks.push({
        id,
        op: "added",
        blockType: blockType(bBlock),
        before: "",
        after: flatBlockText(bBlock),
        toIndex: bIndex,
      });
      stats.added += 1;
      return;
    }

    const before = flatBlockText(inA.block);
    const after = flatBlockText(bBlock);
    const textChanged = before !== after;
    const moved = inA.index !== bIndex;

    if (textChanged) {
      hunks.push({
        id,
        op: "changed",
        blockType: blockType(bBlock),
        before,
        after,
        inline: inlineWordDiff(before, after),
        fromIndex: inA.index,
        toIndex: bIndex,
      });
      stats.changed += 1;
    } else if (moved) {
      hunks.push({
        id,
        op: "moved",
        blockType: blockType(bBlock),
        before,
        after,
        fromIndex: inA.index,
        toIndex: bIndex,
      });
      stats.moved += 1;
    } else {
      hunks.push({
        id,
        op: "unchanged",
        blockType: blockType(bBlock),
        before,
        after,
        fromIndex: inA.index,
        toIndex: bIndex,
      });
      stats.unchanged += 1;
    }
  });

  // Any remaining A-only blocks (positioned after the last B block) → removed.
  aBlocks.forEach((block, index) => {
    const id = blockId(block, index);
    if (bById.has(id) || emittedFromA.has(id)) return;
    emittedFromA.add(id);
    hunks.push({
      id,
      op: "removed",
      blockType: blockType(block),
      before: flatBlockText(block),
      after: "",
      fromIndex: index,
    });
    stats.removed += 1;
  });

  return { hunks, stats };
}

/** True when two snapshots are textually identical at the block level. */
export function diffIsEmpty(diff: DocumentDiff): boolean {
  return (
    diff.stats.added === 0 &&
    diff.stats.removed === 0 &&
    diff.stats.moved === 0 &&
    diff.stats.changed === 0
  );
}

/**
 * One-line summary of a diff for list rows / activity ("+3 −1 ~2"). Mirrors the
 * suggestion summary phrasing so the UI is consistent.
 */
export function summarizeDiff(stats: DiffStats): string {
  const parts: string[] = [];
  if (stats.added) parts.push(`+${stats.added} added`);
  if (stats.removed) parts.push(`${stats.removed} removed`);
  if (stats.changed) parts.push(`${stats.changed} changed`);
  if (stats.moved) parts.push(`${stats.moved} moved`);
  return parts.length ? parts.join(" · ") : "No changes";
}
