import { describe, expect, it } from "vitest";

import {
  diffDocuments,
  diffIsEmpty,
  inlineWordDiff,
  summarizeDiff,
  type BlockDiffHunk,
} from "./diff";
import type { BlockNoteBlock } from "../documents/block-content";

function block(id: string, text: string, type = "paragraph"): BlockNoteBlock {
  return { id, type, props: {}, content: [{ type: "text", text }] };
}

function codeBlock(id: string, code: string): BlockNoteBlock {
  return { id, type: "codeBlock", props: { code }, content: [] };
}

function byId(hunks: BlockDiffHunk[], id: string): BlockDiffHunk {
  const h = hunks.find((x) => x.id === id);
  if (!h) throw new Error(`no hunk for ${id}`);
  return h;
}

describe("diffDocuments — empty / unchanged", () => {
  it("two empty docs produce an empty diff", () => {
    const d = diffDocuments([], []);
    expect(d.hunks).toEqual([]);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it("identical docs are all unchanged", () => {
    const doc = [block("a", "hello"), block("b", "world")];
    const d = diffDocuments(doc, doc);
    expect(d.stats).toEqual({
      added: 0,
      removed: 0,
      moved: 0,
      changed: 0,
      unchanged: 2,
    });
    expect(diffIsEmpty(d)).toBe(true);
    expect(d.hunks.every((h) => h.op === "unchanged")).toBe(true);
  });

  it("treats null / non-array bodies as empty", () => {
    const d = diffDocuments(null, undefined);
    expect(d.hunks).toEqual([]);
  });
});

describe("diffDocuments — added", () => {
  it("detects an appended block", () => {
    const a = [block("a", "one")];
    const b = [block("a", "one"), block("b", "two")];
    const d = diffDocuments(a, b);
    expect(d.stats.added).toBe(1);
    const h = byId(d.hunks, "b");
    expect(h.op).toBe("added");
    expect(h.before).toBe("");
    expect(h.after).toBe("two");
    expect(diffIsEmpty(d)).toBe(false);
  });

  it("detects an inserted block in the middle", () => {
    const a = [block("a", "one"), block("c", "three")];
    const b = [block("a", "one"), block("b", "two"), block("c", "three")];
    const d = diffDocuments(a, b);
    expect(d.stats.added).toBe(1);
    expect(byId(d.hunks, "b").op).toBe("added");
    // 'c' did not move logically relative to insertion-by-id? Index shifted 1→2.
    expect(byId(d.hunks, "c").op).toBe("moved");
  });
});

describe("diffDocuments — removed", () => {
  it("detects a removed trailing block", () => {
    const a = [block("a", "one"), block("b", "two")];
    const b = [block("a", "one")];
    const d = diffDocuments(a, b);
    expect(d.stats.removed).toBe(1);
    const h = byId(d.hunks, "b");
    expect(h.op).toBe("removed");
    expect(h.before).toBe("two");
    expect(h.after).toBe("");
  });

  it("removed block is emitted near its original position", () => {
    const a = [block("a", "one"), block("b", "two"), block("c", "three")];
    const b = [block("a", "one"), block("c", "three")];
    const d = diffDocuments(a, b);
    const ids = d.hunks.map((h) => h.id);
    // 'b' (removed) should appear between 'a' and 'c'.
    expect(ids.indexOf("b")).toBeGreaterThan(ids.indexOf("a"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });
});

describe("diffDocuments — changed (with inline word diff)", () => {
  it("detects a text change and produces inline segments", () => {
    const a = [block("a", "the quick brown fox")];
    const b = [block("a", "the slow brown fox")];
    const d = diffDocuments(a, b);
    expect(d.stats.changed).toBe(1);
    const h = byId(d.hunks, "a");
    expect(h.op).toBe("changed");
    expect(h.inline).toBeDefined();
    const added = h.inline!.filter((s) => s.type === "added").map((s) => s.value).join("");
    const removed = h.inline!.filter((s) => s.type === "removed").map((s) => s.value).join("");
    expect(added).toContain("slow");
    expect(removed).toContain("quick");
    // Reconstructing 'after' from non-removed segments equals the new text.
    const after = h.inline!.filter((s) => s.type !== "removed").map((s) => s.value).join("");
    expect(after).toBe("the slow brown fox");
  });

  it("detects code-block payload changes (props.code)", () => {
    const a = [codeBlock("k", "const x = 1")];
    const b = [codeBlock("k", "const x = 2")];
    const d = diffDocuments(a, b);
    expect(d.stats.changed).toBe(1);
    expect(byId(d.hunks, "k").op).toBe("changed");
  });
});

describe("diffDocuments — moved", () => {
  it("detects a reordered block with unchanged text", () => {
    const a = [block("a", "one"), block("b", "two"), block("c", "three")];
    const b = [block("c", "three"), block("a", "one"), block("b", "two")];
    const d = diffDocuments(a, b);
    expect(d.stats.moved).toBe(3);
    const c = byId(d.hunks, "c");
    expect(c.op).toBe("moved");
    expect(c.fromIndex).toBe(2);
    expect(c.toIndex).toBe(0);
  });

  it("a block that both moves and changes is classified as changed", () => {
    const a = [block("a", "one"), block("b", "two")];
    const b = [block("b", "two edited"), block("a", "one")];
    const d = diffDocuments(a, b);
    expect(byId(d.hunks, "b").op).toBe("changed");
    expect(byId(d.hunks, "a").op).toBe("moved");
  });
});

describe("diffDocuments — nested children", () => {
  it("folds child text into the parent block's flattened text", () => {
    const a = [
      { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "parent" }], children: [block("c1", "child one")] },
    ];
    const b = [
      { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "parent" }], children: [block("c1", "child changed")] },
    ];
    const d = diffDocuments(a, b);
    const h = byId(d.hunks, "p");
    expect(h.op).toBe("changed");
    expect(h.before).toContain("child one");
    expect(h.after).toContain("child changed");
  });
});

describe("diffDocuments — id-less blocks", () => {
  it("falls back to positional ids and still diffs text", () => {
    const a = [{ type: "paragraph", props: {}, content: [{ type: "text", text: "x" }] }];
    const b = [{ type: "paragraph", props: {}, content: [{ type: "text", text: "y" }] }];
    const d = diffDocuments(a, b);
    expect(d.stats.changed).toBe(1);
  });
});

describe("inlineWordDiff", () => {
  it("marks insertions and deletions", () => {
    const segs = inlineWordDiff("hello world", "hello brave world");
    expect(segs.some((s) => s.type === "added" && s.value.includes("brave"))).toBe(true);
  });

  it("an identical string yields only unchanged segments", () => {
    const segs = inlineWordDiff("same text", "same text");
    expect(segs.every((s) => s.type === "unchanged")).toBe(true);
  });
});

describe("summarizeDiff", () => {
  it("formats a mixed diff", () => {
    const d = diffDocuments(
      [block("a", "one"), block("b", "two"), block("d", "four")],
      [block("a", "one EDIT"), block("c", "three"), block("d", "four")],
    );
    const s = summarizeDiff(d.stats);
    expect(s).toContain("added");
    expect(s).toContain("removed");
    expect(s).toContain("changed");
  });

  it("reports no changes for an empty diff", () => {
    expect(summarizeDiff(diffDocuments([], []).stats)).toBe("No changes");
  });
});
