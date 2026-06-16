/**
 * Refine / expand flow — take a selected passage + an instruction and stream a
 * proposed revision. The stream lets the UI show the rewrite live; when it
 * completes the client turns it into a track-changes SUGGESTION via the M5
 * shared path (core `diffSuggestion` → `createSuggestion`), NOT a hard
 * overwrite. The AI never mutates the doc directly.
 *
 * The flow is deliberately text-in / text-out so it is provider-agnostic and
 * reusable by M7 single-doc generation. Diff + persistence stay in the
 * web/refine route (which already owns the live body + scope + RBAC).
 */
import { streamText, type StreamTextResult, type ToolSet } from "ai";

import { languageModel } from "../models";

export type RefineMode = "refine" | "expand" | "rewrite";

export interface RefineParams {
  /** The selected text to operate on. */
  selection: string;
  /** Free-form user instruction ("make it more concise", "add error cases"). */
  instruction?: string;
  /** What kind of transform — tunes the system prompt. */
  mode?: RefineMode;
  /** Optional surrounding document text for grounding (kept short). */
  documentContext?: string;
}

const MODE_GUIDANCE: Record<RefineMode, string> = {
  refine:
    "Improve clarity, correctness, and concision of the selection while preserving its meaning and structure.",
  expand:
    "Expand the selection with relevant detail, edge cases, and specifics appropriate to a technical spec.",
  rewrite:
    "Rewrite the selection to follow the user's instruction precisely.",
};

function systemFor(mode: RefineMode): string {
  return `You are editing a technical specification. ${MODE_GUIDANCE[mode]}

Output ONLY the revised passage as Markdown/plain text — no preamble, no explanation, no code fences around the whole thing. Match the surrounding document's voice and formatting.`;
}

/**
 * Stream the revised passage. Gate on hasApiKey() upstream. The route consumes
 * the text stream (toUIMessageStreamResponse / toTextStreamResponse) and the
 * client, on completion, computes a delta and calls createSuggestion.
 */
export function runRefine(
  params: RefineParams,
): StreamTextResult<ToolSet, never> {
  const { selection, instruction, mode = "refine", documentContext } = params;

  const userParts: string[] = [];
  if (documentContext?.trim()) {
    userParts.push(`Document context (for reference only, do not rewrite this):\n${documentContext.trim()}`);
  }
  userParts.push(`Selected passage to ${mode}:\n"""\n${selection}\n"""`);
  if (instruction?.trim()) {
    userParts.push(`Instruction: ${instruction.trim()}`);
  }

  return streamText({
    model: languageModel("smart"),
    system: systemFor(mode),
    prompt: userParts.join("\n\n"),
  });
}
