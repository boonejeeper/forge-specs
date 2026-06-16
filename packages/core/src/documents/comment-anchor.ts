/**
 * Comment anchoring against the BlockNote collaborative document.
 *
 * THREE-SOURCES-OF-TRUTH RULE (see plan): a comment's ANCHOR — which block /
 * text range it points at — is convergent content that must survive concurrent
 * edits, so it lives in Yjs as a *relative position* (a `Y.RelativePosition`,
 * stable across insertions/deletions by other users). The comment's BODY,
 * author, resolution and threading are queryable server facts and live in
 * Postgres (the `Comment` model). This module owns only the anchor encoding.
 *
 * y-prosemirror / BlockNote structure (see `yjs-projection.ts`): the fragment's
 * children are `blockContainer` elements (the fragment index space counts those
 * NODES, not characters). The editable prose of a block lives in a `Y.XmlText`
 * inside the block's content node. So a *text-range* anchor must bind its
 * relative positions to that inner `Y.XmlText`, identified by the block's `id`
 * attribute — which the client already knows from the selection. A *block-level*
 * anchor (no range) just records the blockId.
 *
 * At render time the client resolves the stored anchor back to an *absolute*
 * position in the live `Y.Doc` to know where to draw the thread (margin marker /
 * popover). Because positions are relative, an anchor created at offset 10 stays
 * glued to the same logical spot even after a peer inserts text before it.
 *
 * Dependency-light: only needs `yjs` (a direct dep) and runs in both Node and
 * the browser, so it is fully unit-testable by building a Y.Doc in memory.
 */
import * as Y from "yjs";

import { BLOCKNOTE_FRAGMENT } from "./yjs-projection";

const BLOCK_CONTAINER = "blockContainer";
const BLOCK_GROUP = "blockGroup";

/**
 * Serialized anchor stored in `Comment.anchor`. Always carries `blockId` (the
 * BlockNote block the thread is attached to). For a text-range anchor it also
 * carries base64-encoded `Y.RelativePosition`s for the start/end of the range
 * within that block's text; for a whole-block anchor those are omitted.
 *
 * `blockId` is denormalized (mirrors `Comment.blockId`) so the sidebar can
 * group/sort threads by block without decoding every anchor.
 */
export interface SerializedCommentAnchor {
  /** Encoding version, for forward migration. */
  v: 1;
  /** Y.XmlFragment the block lives in. */
  fragment: string;
  /** BlockNote block id the anchor is attached to. */
  blockId: string;
  /** base64 Y.RelativePosition for the range start, within the block text. */
  start?: string;
  /** base64 Y.RelativePosition for the range end. Omitted for a block anchor. */
  end?: string;
}

/** A resolved absolute range, expressed as character offsets within block text. */
export interface ResolvedCommentRange {
  blockId: string;
  /** The Yjs text type the offsets index into (null for a block-level anchor). */
  type: Y.AbstractType<unknown> | null;
  start: number;
  end: number;
  /** True when the anchor is whole-block (no text range). */
  block: boolean;
}

// Base64 helpers that work in BOTH the browser (the comment UI resolves anchors
// client-side) and Node (collab server / Next server) without a Buffer polyfill.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(s: string): Uint8Array {
  const binary =
    typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Locate the `Y.XmlText` carrying a block's editable prose, by the block's `id`
 * attribute. Walks blockContainers (recursing into nested blockGroups) and
 * returns the first text node inside the matching container's content node.
 * Returns null when the block (or its text) can't be found.
 */
export function findBlockText(
  doc: Y.Doc,
  blockId: string,
  fragmentName: string = BLOCKNOTE_FRAGMENT,
): Y.XmlText | null {
  const fragment = doc.getXmlFragment(fragmentName);
  return searchGroup(fragment.toArray() as Array<Y.XmlElement | Y.XmlText>, blockId);
}

function searchGroup(
  nodes: Array<Y.XmlElement | Y.XmlText>,
  blockId: string,
): Y.XmlText | null {
  for (const node of nodes) {
    if (!(node instanceof Y.XmlElement)) continue;
    if (node.nodeName === BLOCK_GROUP) {
      const found = searchGroup(
        node.toArray() as Array<Y.XmlElement | Y.XmlText>,
        blockId,
      );
      if (found) return found;
      continue;
    }
    if (node.nodeName !== BLOCK_CONTAINER) continue;

    const attrs = node.getAttributes() as Record<string, unknown>;
    const children = node.toArray() as Array<Y.XmlElement | Y.XmlText>;
    if (attrs.id === blockId) {
      // First non-blockGroup element child is the content node holding the text.
      for (const child of children) {
        if (child instanceof Y.XmlElement && child.nodeName !== BLOCK_GROUP) {
          for (const inner of child.toArray() as Array<Y.XmlElement | Y.XmlText>) {
            if (inner instanceof Y.XmlText) return inner;
          }
          // Content node exists but has no text run yet.
          return null;
        }
      }
      return null;
    }
    // Recurse into a nested child group.
    for (const child of children) {
      if (child instanceof Y.XmlElement && child.nodeName === BLOCK_GROUP) {
        const found = searchGroup(
          child.toArray() as Array<Y.XmlElement | Y.XmlText>,
          blockId,
        );
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Build a serialized anchor from a selection within a block. The client passes
 * the `blockId` plus character offsets into that block's text (`start`/`end`).
 * Omit the offsets (or pass equal/undefined) for a whole-block anchor.
 *
 * `assoc` controls which side of the gap each position sticks to: start sticks
 * right (1), end sticks left (-1), so typing immediately outside the range
 * doesn't grow it.
 */
export function createCommentAnchor(
  doc: Y.Doc,
  range: { blockId: string; start?: number; end?: number },
  opts: { fragmentName?: string } = {},
): SerializedCommentAnchor {
  const fragmentName = opts.fragmentName ?? BLOCKNOTE_FRAGMENT;

  const base: SerializedCommentAnchor = {
    v: 1,
    fragment: fragmentName,
    blockId: range.blockId,
  };

  if (range.start === undefined || range.end === undefined) return base;

  const text = findBlockText(doc, range.blockId, fragmentName);
  if (!text) return base; // block exists but no text → block-level anchor

  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  if (lo === hi) return base; // collapsed → treat as block-level

  const startRel = Y.createRelativePositionFromTypeIndex(text, lo, 1);
  const endRel = Y.createRelativePositionFromTypeIndex(text, hi, -1);

  return {
    ...base,
    start: toBase64(Y.encodeRelativePosition(startRel)),
    end: toBase64(Y.encodeRelativePosition(endRel)),
  };
}

/** Type guard for a stored anchor blob. */
export function isSerializedCommentAnchor(
  value: unknown,
): value is SerializedCommentAnchor {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    a.v === 1 &&
    typeof a.fragment === "string" &&
    typeof a.blockId === "string"
  );
}

/**
 * Resolve a serialized anchor back to an absolute range in the live `Y.Doc`.
 *
 * For a text-range anchor, returns character offsets within the block's text.
 * Returns `null` when the block was deleted or either endpoint can no longer be
 * resolved (the anchored content was removed) — the caller treats null as an
 * "orphaned" thread (listed in the sidebar, no inline marker). This is the
 * load-bearing behaviour the comment UI relies on.
 */
export function resolveCommentAnchor(
  doc: Y.Doc,
  anchor: SerializedCommentAnchor,
): ResolvedCommentRange | null {
  const fragmentName = anchor.fragment || BLOCKNOTE_FRAGMENT;
  const text = findBlockText(doc, anchor.blockId, fragmentName);

  // Whole-block anchor (or block whose text run is gone): if the block itself
  // still exists we report a block-level resolution.
  if (anchor.start === undefined || anchor.end === undefined) {
    if (!blockExists(doc, anchor.blockId, fragmentName)) return null;
    return {
      blockId: anchor.blockId,
      type: (text as Y.AbstractType<unknown> | null) ?? null,
      start: 0,
      end: 0,
      block: true,
    };
  }

  if (!text) return null;

  const startRel = Y.decodeRelativePosition(fromBase64(anchor.start));
  const endRel = Y.decodeRelativePosition(fromBase64(anchor.end));
  const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, doc);
  const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, doc);

  if (!startAbs || !endAbs) return null;
  if (
    (startAbs.type as Y.AbstractType<unknown>) !== (text as Y.AbstractType<unknown>) ||
    (endAbs.type as Y.AbstractType<unknown>) !== (text as Y.AbstractType<unknown>)
  ) {
    return null;
  }

  const start = Math.min(startAbs.index, endAbs.index);
  const end = Math.max(startAbs.index, endAbs.index);
  return {
    blockId: anchor.blockId,
    type: text as Y.AbstractType<unknown>,
    start,
    end,
    block: false,
  };
}

/** Does a block with this id still exist in the document? */
export function blockExists(
  doc: Y.Doc,
  blockId: string,
  fragmentName: string = BLOCKNOTE_FRAGMENT,
): boolean {
  const fragment = doc.getXmlFragment(fragmentName);
  return containerExists(fragment.toArray() as Array<Y.XmlElement | Y.XmlText>, blockId);
}

function containerExists(
  nodes: Array<Y.XmlElement | Y.XmlText>,
  blockId: string,
): boolean {
  for (const node of nodes) {
    if (!(node instanceof Y.XmlElement)) continue;
    if (node.nodeName === BLOCK_GROUP) {
      if (containerExists(node.toArray() as Array<Y.XmlElement | Y.XmlText>, blockId))
        return true;
      continue;
    }
    if (node.nodeName !== BLOCK_CONTAINER) continue;
    const attrs = node.getAttributes() as Record<string, unknown>;
    if (attrs.id === blockId) return true;
    if (containerExists(node.toArray() as Array<Y.XmlElement | Y.XmlText>, blockId))
      return true;
  }
  return false;
}

/** Is the resolved anchor a collapsed point / whole-block (no width)? */
export function isPointAnchor(range: ResolvedCommentRange): boolean {
  return range.block || range.start === range.end;
}
