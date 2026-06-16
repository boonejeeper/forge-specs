import { describe, expect, it } from "vitest";

import { genBlockToBlockNote, genBlocksToBlockNote } from "./blocks";

describe("genBlockToBlockNote", () => {
  it("maps a heading with level", () => {
    const b = genBlockToBlockNote({ kind: "heading", text: "Hi", level: 1 });
    expect(b.type).toBe("heading");
    expect(b.props?.level).toBe(1);
    expect(b.content?.[0]?.text).toBe("Hi");
  });
  it("defaults heading level to 2", () => {
    const b = genBlockToBlockNote({ kind: "heading", text: "Hi" });
    expect(b.props?.level).toBe(2);
  });
  it("maps bullet/numbered list items", () => {
    expect(genBlockToBlockNote({ kind: "bullet", text: "a" }).type).toBe(
      "bulletListItem",
    );
    expect(genBlockToBlockNote({ kind: "numbered", text: "b" }).type).toBe(
      "numberedListItem",
    );
  });
  it("maps a code block carrying code+language in props", () => {
    const b = genBlockToBlockNote({
      kind: "code",
      text: "",
      code: "const x = 1;",
      language: "ts",
    });
    expect(b.type).toBe("code");
    expect(b.props?.code).toBe("const x = 1;");
    expect(b.props?.language).toBe("ts");
  });
  it("maps a mermaid block to props.code", () => {
    const b = genBlockToBlockNote({
      kind: "mermaid",
      text: "",
      code: "graph TD; A-->B",
    });
    expect(b.type).toBe("mermaid");
    expect(b.props?.code).toBe("graph TD; A-->B");
  });
  it("falls back to paragraph for plain text", () => {
    expect(genBlockToBlockNote({ kind: "paragraph", text: "hello" }).type).toBe(
      "paragraph",
    );
  });
});

describe("genBlocksToBlockNote", () => {
  it("returns a single empty paragraph for an empty list (BlockNote needs >=1)", () => {
    const doc = genBlocksToBlockNote([]);
    expect(doc).toHaveLength(1);
    expect(doc[0]!.type).toBe("paragraph");
  });
  it("preserves order and length", () => {
    const doc = genBlocksToBlockNote([
      { kind: "heading", text: "T", level: 1 },
      { kind: "paragraph", text: "p" },
      { kind: "bullet", text: "x" },
    ]);
    expect(doc.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "bulletListItem",
    ]);
  });
});
