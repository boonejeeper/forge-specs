import { describe, expect, it } from "vitest";

import {
  rfcSchema,
  architectureSchema,
  archNodeSchema,
  tasksSchema,
  epicsSchema,
  repoStructureSchema,
  agentPromptsSchema,
  changelogSchema,
} from "./schemas";

describe("rfcSchema", () => {
  it("requires title/summary/problem and defaults arrays", () => {
    const r = rfcSchema.parse({
      title: "Auth",
      summary: "s",
      problem: "p",
    });
    expect(r.requirements).toEqual([]);
    expect(r.sequenceDiagrams).toEqual([]);
    expect(r.acceptanceCriteria).toEqual([]);
  });
  it("rejects missing title", () => {
    expect(rfcSchema.safeParse({ summary: "s", problem: "p" }).success).toBe(false);
  });
  it("rejects empty mermaid in a sequence diagram", () => {
    const bad = rfcSchema.safeParse({
      title: "t",
      summary: "s",
      problem: "p",
      sequenceDiagrams: [{ title: "x", mermaid: "" }],
    });
    expect(bad.success).toBe(false);
  });
});

describe("archNodeSchema", () => {
  it("defaults parentRef=null and blocks=[]", () => {
    const n = archNodeSchema.parse({ ref: "vision", type: "VISION", title: "V" });
    expect(n.parentRef).toBeNull();
    expect(n.blocks).toEqual([]);
  });
  it("rejects an invalid document type", () => {
    expect(
      archNodeSchema.safeParse({ ref: "x", type: "NOPE", title: "t" }).success,
    ).toBe(false);
  });
});

describe("architectureSchema", () => {
  it("requires at least one node and defaults edges", () => {
    const a = architectureSchema.parse({
      projectName: "Forge",
      nodes: [{ ref: "v", type: "VISION", title: "Vision" }],
    });
    expect(a.edges).toEqual([]);
    expect(a.nodes).toHaveLength(1);
  });
  it("rejects empty nodes", () => {
    expect(
      architectureSchema.safeParse({ projectName: "x", nodes: [] }).success,
    ).toBe(false);
  });
  it("validates edge kind enum", () => {
    const bad = architectureSchema.safeParse({
      projectName: "x",
      nodes: [{ ref: "v", type: "VISION", title: "V" }],
      edges: [{ fromRef: "a", toRef: "b", kind: "WAT" }],
    });
    expect(bad.success).toBe(false);
  });
});

describe("tasksSchema / epicsSchema", () => {
  it("tasks require at least one and default estimate=M", () => {
    const t = tasksSchema.parse({ tasks: [{ title: "Do thing" }] });
    expect(t.tasks[0]!.estimate).toBe("M");
    expect(t.tasks[0]!.acceptanceCriteria).toEqual([]);
  });
  it("rejects empty tasks", () => {
    expect(tasksSchema.safeParse({ tasks: [] }).success).toBe(false);
  });
  it("epics require at least one", () => {
    expect(epicsSchema.parse({ epics: [{ title: "E" }] }).epics).toHaveLength(1);
    expect(epicsSchema.safeParse({ epics: [] }).success).toBe(false);
  });
});

describe("repoStructureSchema", () => {
  it("requires at least one node with a valid kind", () => {
    const r = repoStructureSchema.parse({
      nodes: [{ path: "src/index.ts", kind: "file" }],
    });
    expect(r.nodes[0]!.purpose).toBe("");
  });
  it("rejects an invalid kind", () => {
    expect(
      repoStructureSchema.safeParse({ nodes: [{ path: "x", kind: "symlink" }] }).success,
    ).toBe(false);
  });
});

describe("agentPromptsSchema", () => {
  it("validates agent enum + requires a systemPrompt", () => {
    const a = agentPromptsSchema.parse({
      agents: [{ agent: "Backend", systemPrompt: "do backend" }],
    });
    expect(a.agents[0]!.firstTasks).toEqual([]);
  });
  it("rejects an unknown agent", () => {
    expect(
      agentPromptsSchema.safeParse({
        agents: [{ agent: "QA", systemPrompt: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("changelogSchema", () => {
  it("requires a non-empty summary", () => {
    expect(changelogSchema.parse({ summary: "Added auth" }).summary).toBe("Added auth");
    expect(changelogSchema.safeParse({ summary: "" }).success).toBe(false);
  });
});
