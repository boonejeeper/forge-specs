import { describe, it, expect } from "vitest";
import {
  blocknoteToPlainText,
  blockText,
  projectBlocks,
} from "./block-content";

const sampleDoc = [
  {
    id: "1",
    type: "heading",
    props: { level: 1 },
    content: [{ type: "text", text: "Title" }],
  },
  {
    id: "2",
    type: "paragraph",
    content: [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
      {
        type: "link",
        content: [{ type: "text", text: "link text" }],
      },
    ],
    children: [
      {
        id: "2a",
        type: "paragraph",
        content: [{ type: "text", text: "nested child" }],
      },
    ],
  },
  {
    id: "3",
    type: "codeBlock",
    props: { language: "ts", code: "const x = 1;" },
    content: [],
  },
];

describe("blocknoteToPlainText", () => {
  it("flattens nested blocks and inline content in document order", () => {
    expect(blocknoteToPlainText(sampleDoc)).toBe(
      "Title\nHello worldlink text\nnested child\nconst x = 1;",
    );
  });

  it("returns empty string for non-array input", () => {
    expect(blocknoteToPlainText(null)).toBe("");
    expect(blocknoteToPlainText(undefined)).toBe("");
    expect(blocknoteToPlainText({})).toBe("");
  });

  it("surfaces mention labels from inline props", () => {
    const doc = [
      {
        id: "1",
        type: "paragraph",
        content: [
          { type: "text", text: "cc " },
          { type: "mention", props: { label: "@alice" } },
        ],
      },
    ];
    expect(blocknoteToPlainText(doc)).toBe("cc @alice");
  });
});

describe("blockText", () => {
  it("prefers the code prop for code/mermaid blocks", () => {
    expect(
      blockText({ type: "mermaid", props: { code: "graph TD; A-->B" } }),
    ).toBe("graph TD; A-->B");
  });

  it("reads inline content otherwise", () => {
    expect(
      blockText({ type: "paragraph", content: [{ type: "text", text: "hi" }] }),
    ).toBe("hi");
  });
});

describe("projectBlocks", () => {
  it("emits a flat depth-first list with parent links and order", () => {
    const rows = projectBlocks(sampleDoc);
    expect(rows.map((r) => r.id)).toEqual(["1", "2", "2a", "3"]);
    const nested = rows.find((r) => r.id === "2a")!;
    expect(nested.parentId).toBe("2");
    expect(nested.order).toBe(0);
    expect(rows.find((r) => r.id === "3")!.text).toBe("const x = 1;");
  });

  it("synthesizes ids for blocks missing one", () => {
    const rows = projectBlocks([{ type: "paragraph", content: [] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toMatch(/^b\d+$/);
  });

  it("returns empty for non-array input", () => {
    expect(projectBlocks(null)).toEqual([]);
  });
});
