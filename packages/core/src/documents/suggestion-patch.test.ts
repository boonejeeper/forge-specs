import { describe, expect, it } from "vitest";

import {
  applySuggestion,
  diffSuggestion,
  isDelta,
  revertSuggestion,
  summarizeSuggestion,
  validateSuggestion,
} from "./suggestion-patch";
import type { BlockNoteBlock } from "./block-content";

function block(id: string, text: string): BlockNoteBlock {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text }] };
}

describe("diffSuggestion / applySuggestion", () => {
  it("returns undefined for an unchanged document", () => {
    const doc = [block("a", "hello")];
    expect(diffSuggestion(doc, doc)).toBeUndefined();
  });

  it("round-trips a text modification", () => {
    const base = [block("a", "hello"), block("b", "world")];
    const proposed = [block("a", "hello there"), block("b", "world")];
    const patch = diffSuggestion(base, proposed);
    expect(patch).toBeDefined();
    expect(applySuggestion(base, patch!)).toEqual(proposed);
  });

  it("applies an inserted block", () => {
    const base = [block("a", "one")];
    const proposed = [block("a", "one"), block("b", "two")];
    const patch = diffSuggestion(base, proposed)!;
    expect(applySuggestion(base, patch)).toEqual(proposed);
  });

  it("applies a removed block", () => {
    const base = [block("a", "one"), block("b", "two")];
    const proposed = [block("a", "one")];
    const patch = diffSuggestion(base, proposed)!;
    expect(applySuggestion(base, patch)).toEqual(proposed);
  });

  it("does not mutate the input target", () => {
    const base = [block("a", "hello")];
    const proposed = [block("a", "changed")];
    const patch = diffSuggestion(base, proposed)!;
    applySuggestion(base, patch);
    expect(base[0]!.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("treats a null/undefined body as an empty document", () => {
    const proposed = [block("a", "new")];
    const patch = diffSuggestion(null, proposed)!;
    expect(applySuggestion(undefined, patch)).toEqual(proposed);
  });
});

describe("revertSuggestion", () => {
  it("undoes an applied patch", () => {
    const base = [block("a", "hello")];
    const proposed = [block("a", "hello there")];
    const patch = diffSuggestion(base, proposed)!;
    const applied = applySuggestion(base, patch);
    expect(revertSuggestion(applied, patch)).toEqual(base);
  });
});

describe("validateSuggestion", () => {
  it("rejects a non-delta value", () => {
    const res = validateSuggestion([block("a", "x")], [1, 2, 3]);
    expect(res.ok).toBe(false);
  });

  it("accepts a delta that applies cleanly to the live doc", () => {
    const base = [block("a", "hello")];
    const proposed = [block("a", "hello!")];
    const patch = diffSuggestion(base, proposed)!;
    const res = validateSuggestion(base, patch);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual(proposed);
  });

  it("still applies against a doc that drifted in an unrelated block (id-keyed)", () => {
    const base = [block("a", "hello"), block("b", "keep")];
    const proposed = [block("a", "hello edited"), block("b", "keep")];
    const patch = diffSuggestion(base, proposed)!;
    // Live doc gained a new block d AND the unrelated block b is unchanged.
    const live = [block("a", "hello"), block("b", "keep"), block("d", "new")];
    const res = validateSuggestion(live, patch);
    expect(res.ok).toBe(true);
  });
});

describe("summarizeSuggestion", () => {
  it("counts an add", () => {
    const patch = diffSuggestion([block("a", "x")], [block("a", "x"), block("b", "y")])!;
    expect(summarizeSuggestion(patch).added).toBe(1);
  });

  it("counts a removal", () => {
    const patch = diffSuggestion([block("a", "x"), block("b", "y")], [block("a", "x")])!;
    expect(summarizeSuggestion(patch).removed).toBe(1);
  });

  it("counts a modification", () => {
    const patch = diffSuggestion([block("a", "x")], [block("a", "changed")])!;
    expect(summarizeSuggestion(patch).modified).toBe(1);
  });

  it("returns zeros for a non-delta", () => {
    expect(summarizeSuggestion(undefined)).toEqual({
      added: 0,
      removed: 0,
      modified: 0,
      moved: 0,
    });
  });
});

describe("isDelta", () => {
  it("accepts an object delta", () => {
    expect(isDelta({ _t: "a" })).toBe(true);
  });
  it("rejects arrays and null", () => {
    expect(isDelta([1])).toBe(false);
    expect(isDelta(null)).toBe(false);
  });
});
