/**
 * generate-architecture — the flagship flow. Idea + requirements + constraints +
 * tech-prefs → a full doc TREE (Vision, PRD, RFC tree, ADRs, DB schema, event
 * model, OpenAPI sketch, deployment, roadmap) plus inter-doc Dependency edges.
 *
 * The output is a FLAT array of nodes (ref + parentRef) + a flat array of edges
 * — never deep recursion (see schemas.ts rationale). This is what the resumable
 * job + materializer consume.
 *
 * Two entry points:
 *   - `streamArchitecture` → streamObject for the wizard's live tree.
 *   - `generateArchitecture` → generateObject (batch) for the job + tests.
 *
 * Lazy provider: gate on hasApiKey() upstream.
 */
import { generateObject, streamObject } from "ai";

import { languageModel } from "../models";
import { architectureSchema, type GeneratedArchitecture } from "./schemas";

export interface ArchitectureInput {
  /** The core idea / product one-liner. */
  idea: string;
  /** Requirements (free text, bullets, etc.). */
  requirements?: string;
  /** Constraints (compliance, budget, team size, deadlines). */
  constraints?: string;
  /** Technology preferences (languages, frameworks, cloud, datastores). */
  techPrefs?: string;
}

export interface GenerateArchitectureParams extends ArchitectureInput {
  /** Optional pre-assembled context for grounding in an existing project. */
  contextBlock?: string;
  /** Test/override hook: inject a model (mock). */
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You are a staff architect generating a COMPLETE architecture spec set for a new system. Output a flat list of documents and the dependency edges between them.

Produce these documents (each as a node):
- exactly one VISION (root, parentRef=null)
- one PRD deriving from the Vision
- multiple RFC documents for the major subsystems
- ADR documents for the key architectural decisions
- one DB_SCHEMA document (describe the data model; include a Mermaid erDiagram block)
- one API_SPEC document (an OpenAPI sketch as a yaml code block)
- a WORKFLOW document for the event/messaging model (include a Mermaid diagram)
- a RUNBOOK document for deployment
- one TASK_PLAN document for the roadmap

Rules:
- Each node needs a unique short 'ref' (e.g. "vision", "prd", "rfc-auth"). 'parentRef' must reference another node's ref, or be null for the Vision root.
- Populate 'blocks' for each node with concrete, sectioned content (headings, paragraphs, bullets, code, mermaid). DB schema → erDiagram mermaid; API spec → yaml code block; event model → mermaid.
- 'edges' express inter-doc relationships by ref using kinds: IMPLEMENTS, REFERENCES, DERIVES_FROM, SUPERSEDES, BLOCKS. e.g. PRD DERIVES_FROM Vision; an RFC IMPLEMENTS the PRD; ADRs REFERENCE their RFC.
- Be specific and buildable. Prefer real names, endpoints, tables.`;

function userPrompt(input: GenerateArchitectureParams): string {
  const parts: string[] = [];
  if (input.contextBlock?.trim()) {
    parts.push(`# Existing context\n${input.contextBlock.trim()}`);
  }
  parts.push(`# Idea\n${input.idea.trim()}`);
  if (input.requirements?.trim()) parts.push(`# Requirements\n${input.requirements.trim()}`);
  if (input.constraints?.trim()) parts.push(`# Constraints\n${input.constraints.trim()}`);
  if (input.techPrefs?.trim()) parts.push(`# Technology preferences\n${input.techPrefs.trim()}`);
  return parts.join("\n\n");
}

/** Stream the architecture object for the wizard's live tree materialization. */
export function streamArchitecture(params: GenerateArchitectureParams) {
  return streamObject({
    model: params.model ?? languageModel("smart"),
    schema: architectureSchema,
    system: SYSTEM,
    prompt: userPrompt(params),
  });
}

/** Batch-generate the full architecture (used by the resumable job + tests). */
export async function generateArchitecture(
  params: GenerateArchitectureParams,
): Promise<GeneratedArchitecture> {
  const { object } = await generateObject({
    model: params.model ?? languageModel("smart"),
    schema: architectureSchema,
    system: SYSTEM,
    prompt: userPrompt(params),
  });
  return object as GeneratedArchitecture;
}
