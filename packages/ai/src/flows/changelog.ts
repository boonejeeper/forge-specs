/**
 * changelog — summarize a version delta into a single changelog line. Uses the
 * `fast` (cheap/low-latency) model because it runs on every version snapshot.
 *
 * Hooked into the version snapshot path (DocumentVersion.summary): generated on
 * version create when an API key is present, no-op otherwise. Callers should
 * gate on hasApiKey() and fall back to the human-provided label.
 */
import { generateObject } from "ai";

import { languageModel } from "../models";
import { changelogSchema, type GeneratedChangelog } from "./schemas";

export interface ChangelogParams {
  /** Document title for context. */
  title: string;
  /** Previous version text (may be empty for the first snapshot). */
  previousText: string;
  /** New version text. */
  currentText: string;
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You write terse, informative changelog lines for documentation versions. Given the old and new text of a spec, output ONE concise line (max ~120 chars) describing what changed — like a good git commit subject. No quotes, no trailing period required.`;

/** Cap input to keep the fast model cheap; we only need the gist of the delta. */
const MAX_CHARS = 6000;

function clip(s: string): string {
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s;
}

/**
 * Generate a one-line changelog summary for a version delta. Throws only if
 * invoked without a key — gate on hasApiKey() upstream.
 */
export async function generateChangelog(
  params: ChangelogParams,
): Promise<string> {
  const prompt = `Document: ${params.title}

# Previous version
${clip(params.previousText) || "(empty — this is the first snapshot)"}

# New version
${clip(params.currentText)}

Summarize what changed in one line.`;

  const { object } = await generateObject({
    model: params.model ?? languageModel("fast"),
    schema: changelogSchema,
    system: SYSTEM,
    prompt,
  });
  return (object as GeneratedChangelog).summary.trim();
}
