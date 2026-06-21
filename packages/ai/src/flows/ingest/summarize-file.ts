import { generateObject } from "ai";

import { languageModel, modelId } from "../../models";
import { fileSummarySchema, type FileSummary } from "./schemas";

/**
 * Per-file structured summary (purpose + public surface + key deps) for one
 * code file in a repo. Uses the FAST model — cheap and high throughput because
 * we may run this over hundreds of files. The synthesizer never sees raw file
 * bodies; it only sees these compact summaries plus the verbatim docs, which
 * keeps the synthesis context-window manageable.
 */

const MAX_INPUT_CHARS = 12_000; // ≈3k tokens, enough to summarize most files.

const SYSTEM = `You read one source file at a time and produce a SHORT structured summary used to ground a downstream synthesis pass. Be terse and concrete — names over prose. If something is unclear from the file alone, omit it rather than guess.`;

export interface SummarizeFileParams {
  /** POSIX repo-relative path, used only for context in the prompt. */
  path: string;
  /** UTF-8 body. Will be truncated to MAX_INPUT_CHARS. */
  body: string;
  /** Override the language model (test hook). */
  model?: Parameters<typeof generateObject>[0]["model"];
}

export interface SummarizeFileResult {
  summary: FileSummary;
  /** The model id used (stamped onto RepoFile.summaryModel). */
  model: string;
}

export async function summarizeFile(
  params: SummarizeFileParams,
): Promise<SummarizeFileResult> {
  const body =
    params.body.length > MAX_INPUT_CHARS
      ? params.body.slice(0, MAX_INPUT_CHARS) + "\n…[truncated]"
      : params.body;

  const { object } = await generateObject({
    model: params.model ?? languageModel("fast"),
    schema: fileSummarySchema,
    system: SYSTEM,
    prompt: `# Path\n${params.path}\n\n# Source\n\n\`\`\`\n${body}\n\`\`\``,
  });

  return { summary: object as FileSummary, model: modelId("fast") };
}
