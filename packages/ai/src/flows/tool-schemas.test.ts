import { describe, expect, it } from "vitest";

import {
  searchSpecsInput,
  getDocumentInput,
  getDependenciesInput,
  proposeEditInput,
} from "./tool-schemas";

describe("searchSpecsInput", () => {
  it("requires a non-empty query and defaults limit", () => {
    const parsed = searchSpecsInput.parse({ query: "auth flow" });
    expect(parsed.limit).toBe(8);
  });
  it("rejects empty query", () => {
    expect(searchSpecsInput.safeParse({ query: "" }).success).toBe(false);
  });
  it("caps limit at 20", () => {
    expect(searchSpecsInput.safeParse({ query: "x", limit: 50 }).success).toBe(false);
  });
});

describe("getDocumentInput", () => {
  it("requires documentId", () => {
    expect(getDocumentInput.safeParse({}).success).toBe(false);
    expect(getDocumentInput.parse({ documentId: "doc_1" }).documentId).toBe("doc_1");
  });
});

describe("getDependenciesInput", () => {
  it("defaults direction=both and maxDepth=2", () => {
    const p = getDependenciesInput.parse({ documentId: "d" });
    expect(p.direction).toBe("both");
    expect(p.maxDepth).toBe(2);
  });
  it("validates direction enum", () => {
    expect(
      getDependenciesInput.safeParse({ documentId: "d", direction: "sideways" }).success,
    ).toBe(false);
  });
  it("bounds maxDepth", () => {
    expect(
      getDependenciesInput.safeParse({ documentId: "d", maxDepth: 99 }).success,
    ).toBe(false);
  });
});

describe("proposeEditInput", () => {
  it("requires documentId + proposedText, blockId/rationale optional", () => {
    const p = proposeEditInput.parse({
      documentId: "d",
      proposedText: "new text",
    });
    expect(p.proposedText).toBe("new text");
    expect(p.blockId).toBeUndefined();
  });
  it("rejects empty proposedText", () => {
    expect(
      proposeEditInput.safeParse({ documentId: "d", proposedText: "" }).success,
    ).toBe(false);
  });
});
