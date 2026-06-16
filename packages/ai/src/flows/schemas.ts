/**
 * Zod schemas for the M7 generation flows.
 *
 * DESIGN: every tree is a FLAT ARRAY + parentRef (never deep recursion). LLMs +
 * JSON-schema-constrained decoding handle a flat list of nodes with string
 * `ref`/`parentRef` far more reliably than nested objects, and a flat list maps
 * cleanly onto our flat Postgres tables (Document rows + Dependency edges). The
 * materializer (web/core) walks refs → ids; nothing here recurses.
 *
 * All schemas are PURE and unit-tested (valid + invalid shapes). The flows feed
 * them to `generateObject`/`streamObject`; the route/job feed the OUTPUT to the
 * materializer.
 */
import { z } from "zod";

import { genBlocksSchema } from "./blocks";

// Mirror the Prisma enums as string unions (no @forgespecs/db import needed here
// — the materializer validates against the real enum when it maps refs → rows).
export const docTypeEnum = z.enum([
  "VISION",
  "PRD",
  "RFC",
  "ADR",
  "API_SPEC",
  "DB_SCHEMA",
  "WORKFLOW",
  "RUNBOOK",
  "TASK_PLAN",
]);
export type GenDocType = z.infer<typeof docTypeEnum>;

export const dependencyKindEnum = z.enum([
  "IMPLEMENTS",
  "REFERENCES",
  "DERIVES_FROM",
  "SUPERSEDES",
  "BLOCKS",
]);
export type GenDependencyKind = z.infer<typeof dependencyKindEnum>;

// ── generate-rfc ────────────────────────────────────────────────────────────

/**
 * A single RFC. The model fills the canonical sections; we materialize them into
 * a BlockNote body (headings + content + mermaid + code) via `rfcToGenBlocks`.
 */
export const rfcSchema = z.object({
  title: z.string().min(1).describe("Concise RFC title."),
  summary: z.string().min(1).describe("One-paragraph summary of the proposal."),
  problem: z.string().min(1).describe("The problem / motivation."),
  requirements: z
    .array(z.string().min(1))
    .default([])
    .describe("Functional + non-functional requirements, as bullets."),
  architecture: z
    .string()
    .default("")
    .describe("Prose describing the proposed architecture."),
  sequenceDiagrams: z
    .array(
      z.object({
        title: z.string().default(""),
        mermaid: z
          .string()
          .min(1)
          .describe("A Mermaid sequenceDiagram (no code fences)."),
      }),
    )
    .default([])
    .describe("Sequence diagrams as Mermaid source."),
  apiContracts: z
    .array(
      z.object({
        name: z.string().default(""),
        sketch: z
          .string()
          .min(1)
          .describe("API contract sketch (OpenAPI-ish or signature block)."),
        language: z.string().default("yaml"),
      }),
    )
    .default([])
    .describe("API contract sketches as code blocks."),
  risks: z.array(z.string().min(1)).default([]).describe("Key risks."),
  alternatives: z
    .array(z.string().min(1))
    .default([])
    .describe("Alternatives considered + why rejected."),
  acceptanceCriteria: z
    .array(z.string().min(1))
    .default([])
    .describe("Testable acceptance criteria."),
});
export type GeneratedRfc = z.infer<typeof rfcSchema>;

// ── generate-architecture (the flagship) ────────────────────────────────────

/**
 * One node in the generated doc tree. `ref` is a generator-local id the model
 * invents (e.g. "rfc-auth"); `parentRef` links a child to its parent node for
 * tree display. Inter-doc relationships are expressed separately as edges so the
 * graph isn't limited to the parent tree.
 */
export const archNodeSchema = z.object({
  ref: z
    .string()
    .min(1)
    .describe("Stable local id for this doc (referenced by edges/children)."),
  parentRef: z
    .string()
    .nullable()
    .default(null)
    .describe("ref of the parent node, or null for a root (e.g. the Vision)."),
  type: docTypeEnum,
  title: z.string().min(1),
  summary: z
    .string()
    .default("")
    .describe("One-line summary used for the placeholder card while generating."),
  /**
   * The body as generator blocks. May be omitted in the first pass (tree only)
   * and filled in a follow-up pass per doc; the materializer seeds whatever is
   * present.
   */
  blocks: genBlocksSchema.default([]),
});
export type ArchNode = z.infer<typeof archNodeSchema>;

/** An inter-doc dependency edge, by ref. Materialized into Dependency rows. */
export const archEdgeSchema = z.object({
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  kind: dependencyKindEnum,
});
export type ArchEdge = z.infer<typeof archEdgeSchema>;

/** The full generated architecture: a flat node list + flat edge list. */
export const architectureSchema = z.object({
  projectName: z.string().min(1).describe("Suggested project / system name."),
  nodes: z
    .array(archNodeSchema)
    .min(1)
    .describe("Flat list of documents (Vision, PRD, RFCs, ADRs, schema, ...)."),
  edges: z
    .array(archEdgeSchema)
    .default([])
    .describe("Inter-document dependency edges, by ref."),
});
export type GeneratedArchitecture = z.infer<typeof architectureSchema>;

// ── agent execution mode: tasks / epics / repo-structure / agent-prompts ─────

export const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  estimate: z
    .enum(["XS", "S", "M", "L", "XL"])
    .default("M")
    .describe("Rough size."),
  dependsOn: z
    .array(z.string())
    .default([])
    .describe("Titles of tasks this one depends on (free-form)."),
});
export type GeneratedTask = z.infer<typeof taskSchema>;

export const tasksSchema = z.object({
  tasks: z.array(taskSchema).min(1),
});
export type GeneratedTasks = z.infer<typeof tasksSchema>;

export const epicSchema = z.object({
  title: z.string().min(1),
  goal: z.string().default(""),
  taskTitles: z
    .array(z.string().min(1))
    .default([])
    .describe("Titles of the tasks rolled up under this epic."),
});
export type GeneratedEpic = z.infer<typeof epicSchema>;

export const epicsSchema = z.object({
  epics: z.array(epicSchema).min(1),
});
export type GeneratedEpics = z.infer<typeof epicsSchema>;

/** A repo node: a file or directory, flat with a POSIX `path`. */
export const repoNodeSchema = z.object({
  path: z.string().min(1).describe("POSIX path, e.g. apps/web/src/index.ts."),
  kind: z.enum(["file", "dir"]),
  purpose: z.string().default("").describe("What lives here / why."),
});
export type GeneratedRepoNode = z.infer<typeof repoNodeSchema>;

export const repoStructureSchema = z.object({
  summary: z.string().default(""),
  nodes: z.array(repoNodeSchema).min(1),
});
export type GeneratedRepoStructure = z.infer<typeof repoStructureSchema>;

/** Agent execution prompts, one per discipline. */
export const agentPromptSchema = z.object({
  agent: z.enum(["Backend", "Frontend", "DevOps", "Platform"]),
  role: z.string().default("").describe("One-line role description."),
  systemPrompt: z
    .string()
    .min(1)
    .describe("The system prompt that primes this agent for the project."),
  firstTasks: z
    .array(z.string().min(1))
    .default([])
    .describe("Concrete first tasks for the agent to pick up."),
});
export type GeneratedAgentPrompt = z.infer<typeof agentPromptSchema>;

export const agentPromptsSchema = z.object({
  agents: z.array(agentPromptSchema).min(1),
});
export type GeneratedAgentPrompts = z.infer<typeof agentPromptsSchema>;

// ── changelog (fast model) ──────────────────────────────────────────────────

export const changelogSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("A single concise changelog line for this version delta."),
});
export type GeneratedChangelog = z.infer<typeof changelogSchema>;
