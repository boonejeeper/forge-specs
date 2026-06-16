import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  blockExists,
  createCommentAnchor,
  findBlockText,
  isPointAnchor,
  isSerializedCommentAnchor,
  resolveCommentAnchor,
} from "./comment-anchor";
import { BLOCKNOTE_FRAGMENT } from "./yjs-projection";

/** Append a blockContainer with id + paragraph text to the fragment. */
function addBlock(doc: Y.Doc, id: string, text: string): void {
  const fragment = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", id);
  const para = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  para.insert(0, [t]);
  container.insert(0, [para]);
  fragment.insert(fragment.length, [container]);
}

function docWith(...blocks: Array<[string, string]>): Y.Doc {
  const doc = new Y.Doc();
  for (const [id, text] of blocks) addBlock(doc, id, text);
  return doc;
}

describe("findBlockText", () => {
  it("finds the inner text node by block id", () => {
    const doc = docWith(["b1", "hello"], ["b2", "world"]);
    const t = findBlockText(doc, "b2");
    expect(t).not.toBeNull();
    expect(t!.toString()).toBe("world");
  });

  it("returns null for an unknown block", () => {
    const doc = docWith(["b1", "hello"]);
    expect(findBlockText(doc, "nope")).toBeNull();
  });
});

describe("createCommentAnchor / resolveCommentAnchor (text range)", () => {
  it("round-trips a range to the same character offsets", () => {
    const doc = docWith(["b1", "hello world"]);
    const anchor = createCommentAnchor(doc, { blockId: "b1", start: 6, end: 11 });
    expect(isSerializedCommentAnchor(anchor)).toBe(true);
    expect(anchor.start).toBeDefined();

    const resolved = resolveCommentAnchor(doc, anchor)!;
    expect(resolved.block).toBe(false);
    expect(resolved.start).toBe(6);
    expect(resolved.end).toBe(11);
  });

  it("follows content when text is inserted BEFORE the anchor", () => {
    const doc = docWith(["b1", "hello world"]);
    const anchor = createCommentAnchor(doc, { blockId: "b1", start: 6, end: 11 });

    // A peer inserts 4 chars at the start of the block's text.
    findBlockText(doc, "b1")!.insert(0, "XXXX");

    const after = resolveCommentAnchor(doc, anchor)!;
    expect(after.end - after.start).toBe(5); // width preserved
    expect(after.start).toBe(10); // 6 + 4 inserted
  });

  it("returns null when the anchored block is deleted (orphaned thread)", () => {
    const doc = docWith(["b1", "hello"], ["b2", "world"]);
    const anchor = createCommentAnchor(doc, { blockId: "b2", start: 0, end: 5 });
    const fragment = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
    fragment.delete(1, 1); // remove b2
    expect(blockExists(doc, "b2")).toBe(false);
    expect(resolveCommentAnchor(doc, anchor)).toBeNull();
  });
});

describe("block-level anchor", () => {
  it("creates a whole-block anchor when no offsets are given", () => {
    const doc = docWith(["b1", "hello"]);
    const anchor = createCommentAnchor(doc, { blockId: "b1" });
    expect(anchor.start).toBeUndefined();
    const resolved = resolveCommentAnchor(doc, anchor)!;
    expect(resolved.block).toBe(true);
    expect(isPointAnchor(resolved)).toBe(true);
  });

  it("collapses a zero-width selection to a block anchor", () => {
    const doc = docWith(["b1", "hello"]);
    const anchor = createCommentAnchor(doc, { blockId: "b1", start: 3, end: 3 });
    expect(anchor.start).toBeUndefined();
  });

  it("resolves null for a block anchor whose block is gone", () => {
    const doc = docWith(["b1", "hello"]);
    const anchor = createCommentAnchor(doc, { blockId: "b1" });
    doc.getXmlFragment(BLOCKNOTE_FRAGMENT).delete(0, 1);
    expect(resolveCommentAnchor(doc, anchor)).toBeNull();
  });
});

describe("isSerializedCommentAnchor", () => {
  it("validates shape", () => {
    expect(isSerializedCommentAnchor(null)).toBe(false);
    expect(isSerializedCommentAnchor({ v: 2 })).toBe(false);
    expect(
      isSerializedCommentAnchor({ v: 1, fragment: "prosemirror", blockId: "b1" }),
    ).toBe(true);
  });
});
