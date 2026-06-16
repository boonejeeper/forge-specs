import { describe, expect, it } from "vitest";

import { rfcToGenBlocks } from "./sections";
import { rfcSchema } from "./schemas";
import { genBlocksToBlockNote } from "./blocks";

describe("rfcToGenBlocks", () => {
  const rfc = rfcSchema.parse({
    title: "Realtime collab",
    summary: "Add Yjs collab.",
    problem: "Single-player only.",
    requirements: ["Cursors", "Persistence"],
    architecture: "ws + Yjs server.",
    sequenceDiagrams: [{ title: "Connect", mermaid: "sequenceDiagram\nA->>B: hi" }],
    apiContracts: [{ name: "WS", sketch: "GET /collab", language: "http" }],
    risks: ["CRDT bugs"],
    alternatives: ["OT"],
    acceptanceCriteria: ["Two clients converge"],
  });

  it("emits a level-1 title heading first", () => {
    const blocks = rfcToGenBlocks(rfc);
    expect(blocks[0]).toEqual({ kind: "heading", text: "Realtime collab", level: 1 });
  });

  it("includes a mermaid block for the sequence diagram", () => {
    const blocks = rfcToGenBlocks(rfc);
    const mermaid = blocks.find((b) => b.kind === "mermaid");
    expect(mermaid?.code).toContain("sequenceDiagram");
  });

  it("includes a code block for the API contract", () => {
    const blocks = rfcToGenBlocks(rfc);
    const code = blocks.find((b) => b.kind === "code");
    expect(code?.code).toBe("GET /collab");
    expect(code?.language).toBe("http");
  });

  it("renders requirements + acceptance criteria as bullets", () => {
    const blocks = rfcToGenBlocks(rfc);
    const bullets = blocks.filter((b) => b.kind === "bullet").map((b) => b.text);
    expect(bullets).toEqual(
      expect.arrayContaining(["Cursors", "Persistence", "Two clients converge"]),
    );
  });

  it("materializes to a valid BlockNote doc with >=1 block", () => {
    const doc = genBlocksToBlockNote(rfcToGenBlocks(rfc));
    expect(doc.length).toBeGreaterThan(1);
    expect(doc[0]!.type).toBe("heading");
  });

  it("omits empty sections", () => {
    const minimal = rfcSchema.parse({ title: "T", summary: "s", problem: "p" });
    const blocks = rfcToGenBlocks(minimal);
    // No requirements/risks/etc → only title, summary, Problem heading + body.
    expect(blocks.some((b) => b.kind === "mermaid")).toBe(false);
    expect(blocks.filter((b) => b.kind === "bullet")).toHaveLength(0);
  });
});
