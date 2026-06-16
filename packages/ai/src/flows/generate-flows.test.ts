/**
 * Flow tests with a MOCK model — no real API calls. We inject a
 * MockLanguageModelV3 whose doGenerate returns a canned JSON object matching the
 * flow's schema; the flow's job is to call generateObject and shape the result
 * into BlockNote blocks, which we assert on.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider";

import { generateRfcDoc } from "./generate-rfc";
import { generateTasks } from "./generate-tasks";
import { generateArchitecture } from "./generate-architecture";
import { generateChangelog } from "./changelog";

/** A mock model that returns the given object (as JSON text) for doGenerate. */
function objectModel(obj: unknown): LanguageModelV3 {
  const text = JSON.stringify(obj);
  const result: LanguageModelV3GenerateResult = {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
  return new MockLanguageModelV3({ doGenerate: async () => result });
}

describe("generateRfcDoc (mock model)", () => {
  it("shapes a structured RFC into a BlockNote body", async () => {
    const model = objectModel({
      title: "Search v2",
      summary: "Hybrid search.",
      problem: "Full-text only.",
      requirements: ["RRF fusion"],
      architecture: "tsvector + pgvector",
      sequenceDiagrams: [{ title: "Query", mermaid: "sequenceDiagram\nU->>S: q" }],
      apiContracts: [{ name: "search", sketch: "POST /search", language: "http" }],
      risks: ["dimension lock-in"],
      alternatives: ["external engine"],
      acceptanceCriteria: ["returns ranked docs"],
    });
    const { rfc, blocks } = await generateRfcDoc({ prompt: "search", model });
    expect(rfc.title).toBe("Search v2");
    expect(blocks[0]!.type).toBe("heading");
    expect(blocks.some((b) => b.type === "mermaid")).toBe(true);
    expect(blocks.some((b) => b.type === "code")).toBe(true);
  });
});

describe("generateTasks (mock model)", () => {
  it("returns tasks + a TASK_PLAN body", async () => {
    const model = objectModel({
      tasks: [
        { title: "Add migration", estimate: "S", acceptanceCriteria: ["applies cleanly"] },
        { title: "Wire route", estimate: "M", dependsOn: ["Add migration"] },
      ],
    });
    const { tasks, blocks } = await generateTasks({ source: "spec", model });
    expect(tasks.tasks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "heading" });
    expect(blocks.some((b) => b.content?.[0]?.text === "applies cleanly")).toBe(
      true,
    );
  });
});

describe("generateArchitecture (mock model)", () => {
  it("returns a flat node/edge tree", async () => {
    const model = objectModel({
      projectName: "Forge",
      nodes: [
        { ref: "vision", parentRef: null, type: "VISION", title: "Vision", summary: "why", blocks: [] },
        { ref: "prd", parentRef: "vision", type: "PRD", title: "PRD", summary: "what", blocks: [] },
      ],
      edges: [{ fromRef: "prd", toRef: "vision", kind: "DERIVES_FROM" }],
    });
    const arch = await generateArchitecture({ idea: "build it", model });
    expect(arch.projectName).toBe("Forge");
    expect(arch.nodes).toHaveLength(2);
    expect(arch.edges[0]!.kind).toBe("DERIVES_FROM");
  });
});

describe("generateChangelog (mock model)", () => {
  it("returns a single summary line", async () => {
    const model = objectModel({ summary: "Added hybrid search section" });
    const line = await generateChangelog({
      title: "Search",
      previousText: "old",
      currentText: "new",
      model,
    });
    expect(line).toBe("Added hybrid search section");
  });
});
