import { describe, expect, it } from "vitest";

import { fuseIdLists, reciprocalRankFusion } from "./fusion";

describe("reciprocalRankFusion", () => {
  it("returns [] for no lists", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("preserves order of a single list", () => {
    const fused = reciprocalRankFusion([{ items: ["a", "b", "c"] }]);
    expect(fused.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("scores by 1/(k+rank) — earlier ranks score higher", () => {
    const fused = reciprocalRankFusion([{ items: ["a", "b"] }], { k: 60 });
    expect(fused[0]!.score).toBeCloseTo(1 / 60);
    expect(fused[1]!.score).toBeCloseTo(1 / 61);
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
  });

  it("rewards items appearing across multiple lists", () => {
    // 'b' is mid-rank in both lists; 'a' is #1 in only one.
    const fused = reciprocalRankFusion([
      { items: ["a", "b", "c"] },
      { items: ["d", "b", "e"] },
    ]);
    const b = fused.find((f) => f.id === "b")!;
    const a = fused.find((f) => f.id === "a")!;
    // b: 1/61 + 1/61; a: 1/60. b's combined contribution should win.
    expect(b.score).toBeGreaterThan(a.score);
    expect(fused[0]!.id).toBe("b");
  });

  it("records per-list ranks", () => {
    const fused = reciprocalRankFusion([
      { items: ["a", "b"] },
      { items: ["b", "a"] },
    ]);
    const a = fused.find((f) => f.id === "a")!;
    expect(a.ranks).toEqual({ 0: 0, 1: 1 });
  });

  it("applies per-list weights", () => {
    const heavy = reciprocalRankFusion(
      [
        { items: ["a"], weight: 10 },
        { items: ["b"], weight: 1 },
      ],
    );
    expect(heavy[0]!.id).toBe("a");
    expect(heavy[0]!.score).toBeCloseTo(10 / 60);
    expect(heavy[1]!.score).toBeCloseTo(1 / 60);
  });

  it("supports a custom idOf for object items", () => {
    const fused = reciprocalRankFusion(
      [
        { items: [{ docId: "x" }, { docId: "y" }] },
        { items: [{ docId: "y" }] },
      ],
      { idOf: (i) => i.docId },
    );
    expect(fused[0]!.id).toBe("y");
    expect(fused[0]!.item).toEqual({ docId: "y" });
  });

  it("larger k flattens the score distribution", () => {
    const tight = reciprocalRankFusion([{ items: ["a", "b"] }], { k: 1 });
    const flat = reciprocalRankFusion([{ items: ["a", "b"] }], { k: 1000 });
    const tightGap = tight[0]!.score - tight[1]!.score;
    const flatGap = flat[0]!.score - flat[1]!.score;
    expect(tightGap).toBeGreaterThan(flatGap);
  });
});

describe("fuseIdLists", () => {
  it("fuses bare id lists and returns ids with scores", () => {
    const out = fuseIdLists([
      { ids: ["a", "b", "c"] },
      { ids: ["c", "a"] },
    ]);
    expect(out.map((o) => o.id)).toContain("a");
    // 'a' and 'c' appear in both; should outrank 'b'.
    const ids = out.map((o) => o.id);
    expect(ids.indexOf("b")).toBe(ids.length - 1);
  });

  it("handles one empty list gracefully", () => {
    const out = fuseIdLists([{ ids: ["a", "b"] }, { ids: [] }]);
    expect(out.map((o) => o.id)).toEqual(["a", "b"]);
  });
});
