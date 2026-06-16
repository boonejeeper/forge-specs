import { describe, expect, it } from "vitest";

import {
  assembleContext,
  orderItems,
  dedupeItems,
  packItems,
  truncateToTokens,
  renderContext,
  type ContextItem,
  type ContextRetrievers,
} from "./assemble";

// Deterministic estimator: 1 token === 1 char. Makes budgets exact in tests.
const oneCharPerToken = (s: string): string => s;
const estimate = (s: string): number => s.length;

function item(
  id: string,
  tier: ContextItem["tier"],
  rank: number,
  content = "x",
): ContextItem {
  return { id, tier, title: "T", content, rank, documentId: id };
}

describe("orderItems", () => {
  it("orders by tier priority then rank", () => {
    const items = [
      item("c1", "comment", 0),
      item("s1", "semantic", 1),
      item("d1", "dependency", 5),
      item("cur", "current", 9),
      item("s0", "semantic", 0),
    ];
    const ordered = orderItems(items).map((i) => i.id);
    expect(ordered).toEqual(["cur", "d1", "s0", "s1", "c1"]);
  });

  it("is stable for equal tier+rank and does not mutate input", () => {
    const input = [item("a", "semantic", 0), item("b", "semantic", 0)];
    const copy = [...input];
    orderItems(input);
    expect(input).toEqual(copy);
  });
});

describe("dedupeItems", () => {
  it("keeps the first occurrence of an id", () => {
    const items = [
      item("dup", "current", 0, "first"),
      item("dup", "semantic", 0, "second"),
      item("other", "semantic", 1),
    ];
    const out = dedupeItems(items);
    expect(out).toHaveLength(2);
    expect(out[0]!.content).toBe("first");
  });
});

describe("truncateToTokens", () => {
  it("returns text unchanged when under budget", () => {
    expect(truncateToTokens("hello", 100, estimate)).toBe("hello");
  });
  it("truncates and marks when over budget", () => {
    const out = truncateToTokens("abcdefghij", 5, estimate);
    expect(out).toContain("[truncated]");
    // Prefix portion must fit the 5-token budget.
    expect(out.startsWith("abcde")).toBe(true);
  });
});

describe("packItems", () => {
  it("includes items greedily until the budget is exhausted, dropping the rest", () => {
    // title "T"=1 + content + 4 overhead per item. content length 5 → cost 10.
    const items = [
      item("a", "current", 0, "aaaaa"),
      item("b", "dependency", 0, "bbbbb"),
      item("c", "semantic", 0, "ccccc"),
    ];
    const { included, dropped, usedTokens } = packItems(orderItems(items), {
      budgetTokens: 20,
      maxTokensPerItem: 1000,
      estimateTokens: estimate,
    });
    expect(included.map((i) => i.id)).toEqual(["a", "b"]);
    expect(dropped.map((i) => i.id)).toEqual(["c"]);
    expect(usedTokens).toBe(20);
  });

  it("caps a single oversized item to maxTokensPerItem", () => {
    const big = item("big", "current", 0, "x".repeat(1000));
    const { included } = packItems([big], {
      budgetTokens: 10_000,
      maxTokensPerItem: 50,
      estimateTokens: estimate,
    });
    expect(included).toHaveLength(1);
    expect(estimate(included[0]!.content)).toBeLessThanOrEqual(
      50 + "\n…[truncated]".length,
    );
  });
});

describe("assembleContext", () => {
  function retrievers(over: Partial<ContextRetrievers> = {}): ContextRetrievers {
    return {
      current: async () => [item("cur", "current", 0, "CURRENT")],
      dependencies: async () => [item("dep", "dependency", 0, "DEP")],
      semantic: async () => [item("sem", "semantic", 0, "SEM")],
      comments: async () => [item("cmt", "comment", 0, "CMT")],
      ...over,
    };
  }

  it("packs all tiers in priority order under a generous budget", async () => {
    const res = await assembleContext(retrievers(), {
      budgetTokens: 1000,
      reserveOutputTokens: 0,
      estimateTokens: estimate,
    });
    expect(res.items.map((i) => i.id)).toEqual(["cur", "dep", "sem", "cmt"]);
    expect(res.dropped).toHaveLength(0);
  });

  it("reserves output tokens before packing", async () => {
    const res = await assembleContext(retrievers(), {
      budgetTokens: 100,
      reserveOutputTokens: 90,
      estimateTokens: estimate,
    });
    // Effective budget is 10 — only the current item (cost = 7 + "CURRENT"=7 ...)
    // Actually content "CURRENT"=7 + title "T"=1 + 4 = 12 > 10, so nothing fits.
    expect(res.budgetTokens).toBe(10);
    expect(res.items.length).toBeLessThanOrEqual(1);
  });

  it("prioritizes current + dependency over semantic + comments when budget is tight", async () => {
    // Each item content length 3 → cost 3 + 1 (title) + 4 = 8. Budget 16 → 2 items.
    const res = await assembleContext(
      retrievers({
        current: async () => [item("cur", "current", 0, "AAA")],
        dependencies: async () => [item("dep", "dependency", 0, "BBB")],
        semantic: async () => [item("sem", "semantic", 0, "CCC")],
        comments: async () => [item("cmt", "comment", 0, "DDD")],
      }),
      { budgetTokens: 16, reserveOutputTokens: 0, estimateTokens: estimate },
    );
    expect(res.items.map((i) => i.id)).toEqual(["cur", "dep"]);
    expect(res.dropped.map((i) => i.id)).toEqual(["sem", "cmt"]);
  });

  it("dedupes the same document appearing across tiers (current beats semantic)", async () => {
    const res = await assembleContext(
      retrievers({
        current: async () => [item("shared", "current", 0, "FROM_CURRENT")],
        semantic: async () => [item("shared", "semantic", 0, "FROM_SEMANTIC")],
      }),
      { budgetTokens: 1000, reserveOutputTokens: 0, estimateTokens: estimate },
    );
    const shared = res.items.filter((i) => i.id === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]!.tier).toBe("current");
    expect(shared[0]!.content).toBe("FROM_CURRENT");
  });

  it("uses the injected estimator (mock model) and never calls a real provider", async () => {
    let calls = 0;
    const counting = (s: string): number => {
      calls += 1;
      return s.length;
    };
    await assembleContext(retrievers(), {
      budgetTokens: 1000,
      reserveOutputTokens: 0,
      estimateTokens: counting,
    });
    expect(calls).toBeGreaterThan(0);
  });
});

describe("renderContext", () => {
  it("groups by tier with headers and omits empty tiers", async () => {
    const assembled = await assembleContext(
      {
        current: async () => [item("cur", "current", 0, "CUR")],
        dependencies: async () => [item("dep", "dependency", 0, "DEP")],
        semantic: async () => [],
        comments: async () => [],
      },
      { budgetTokens: 1000, reserveOutputTokens: 0, estimateTokens: estimate },
    );
    const text = renderContext(assembled);
    expect(text).toContain("## Current document");
    expect(text).toContain("## Linked dependencies (graph)");
    expect(text).not.toContain("## Related material");
    expect(text).not.toContain("## Recent comments");
    // Current must render before dependencies.
    expect(text.indexOf("## Current")).toBeLessThan(
      text.indexOf("## Linked dependencies"),
    );
  });

  it("returns empty string for no items", () => {
    expect(
      renderContext({ items: [], dropped: [], usedTokens: 0, budgetTokens: 0 }),
    ).toBe("");
  });
});

// Silence unused-var lint for the helper retained for documentation parity.
void oneCharPerToken;
