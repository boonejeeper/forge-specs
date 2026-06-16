/**
 * generate-rfc — turn a free-form prompt into a structured RFC, then a
 * BlockNote-compatible body the editor can stream/seed.
 *
 * Two entry points:
 *   - `streamRfc`     → streamObject for live "types itself" UX in the route.
 *   - `generateRfcDoc`→ generateObject (batch) returning the RFC + blocks; used
 *     by tests + non-streaming callers.
 *
 * The flow injects an optional pre-assembled context block (graph + semantic
 * neighbours) so an RFC generated from inside a project is grounded in existing
 * specs. Lazy provider: gate on hasApiKey() upstream.
 */
import { generateObject, streamObject } from "ai";

import { languageModel } from "../models";
import { rfcSchema, type GeneratedRfc } from "./schemas";
import { rfcToGenBlocks } from "./sections";
import { genBlocksToBlockNote, type BlockNoteBlock } from "./blocks";

export interface GenerateRfcParams {
  /** The user's prompt describing what the RFC should cover. */
  prompt: string;
  /** Optional pre-assembled context (renderContext output) for grounding. */
  contextBlock?: string;
  /** Test/override hook: inject a model (mock) instead of the smart model. */
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You are a principal engineer writing a high-quality RFC (Request for Comments) for a technical spec platform.

Produce a complete, concrete RFC. Cover: the problem/motivation, requirements (functional + non-functional), the proposed architecture, sequence diagrams (as Mermaid sequenceDiagram source, no code fences), API contract sketches, risks, alternatives considered, and testable acceptance criteria.

Be specific and pragmatic. Prefer concrete names, endpoints, and data shapes over hand-waving. Mermaid must be valid sequenceDiagram syntax.`;

function userPrompt(prompt: string, contextBlock?: string): string {
  const parts: string[] = [];
  if (contextBlock && contextBlock.trim()) {
    parts.push(`# Existing project context (ground your RFC in this)\n${contextBlock.trim()}`);
  }
  parts.push(`# Write an RFC for:\n${prompt.trim()}`);
  return parts.join("\n\n");
}

/** Stream the RFC object for live UI. The route renders partial blocks. */
export function streamRfc(params: GenerateRfcParams) {
  return streamObject({
    model: params.model ?? languageModel("smart"),
    schema: rfcSchema,
    system: SYSTEM,
    prompt: userPrompt(params.prompt, params.contextBlock),
  });
}

export interface GeneratedRfcDoc {
  rfc: GeneratedRfc;
  blocks: BlockNoteBlock[];
}

/**
 * Batch-generate an RFC and materialize its BlockNote body. Returns both the
 * structured RFC (for metadata/title) and the editor-ready blocks.
 */
export async function generateRfcDoc(
  params: GenerateRfcParams,
): Promise<GeneratedRfcDoc> {
  const { object } = await generateObject({
    model: params.model ?? languageModel("smart"),
    schema: rfcSchema,
    system: SYSTEM,
    prompt: userPrompt(params.prompt, params.contextBlock),
  });
  const rfc = object as GeneratedRfc;
  return { rfc, blocks: genBlocksToBlockNote(rfcToGenBlocks(rfc)) };
}
