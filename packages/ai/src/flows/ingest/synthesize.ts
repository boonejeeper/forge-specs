import { generateObject, generateText } from "ai";

import { languageModel } from "../../models";
import {
  synthesizedDocsSchema,
  type FileSummary,
  type SynthesizedDocs,
} from "./schemas";

/**
 * Repo-wide synthesis. Reads (a) verbatim doc bodies, (b) the per-file
 * summaries, and (c) the repo manifest; emits the canonical ForgeSpecs doc set
 * (VISION/PRD/RFC/ADR/API_SPEC/DB_SCHEMA/WORKFLOW/RUNBOOK) as a flat array of
 * records. Each record carries a stable `slug` (auto-…) so re-runs upsert in
 * place rather than duplicating documents.
 */

export interface SynthesizeInput {
  verbatimDocs: Array<{ path: string; title: string; body: string }>;
  fileSummaries: Array<{ path: string; summary: FileSummary }>;
  manifest: Array<{ path: string; kind: string; bytes: number }>;
  /** Override the language model (test hook). */
  model?: Parameters<typeof generateObject>[0]["model"];
}

const SYSTEM = `You are a staff architect reverse-engineering the canonical specification set for an existing software repository. You will receive:

 - A list of pre-existing markdown documents already present in the repo (verbatim).
 - A list of per-file structured summaries (purpose + public surface + deps).
 - A repo file manifest with sizes and kinds.

Emit the CANONICAL ForgeSpecs document taxonomy. STRICT OUTPUT LIMITS:

 - At most 10 docs total. KEEP EACH BODY UNDER 400 WORDS so the response fits in the token budget. Quality > quantity.
 - Always include exactly one VISION (north-star summary of what the system does and for whom).
 - Include a single DB_SCHEMA only if database schema files or migrations were detected. Include a short \`mermaid\` erDiagram code block.
 - Include a single API_SPEC only if API routes or OpenAPI files were detected. Include a SHORT yaml code block sketching the OpenAPI surface (no more than 10 endpoints).
 - Include 1–2 RFCs covering the largest subsystems detected.
 - Include 1–3 ADRs ONLY for architectural decisions that are clearly evidenced (do not invent decisions).
 - Include a single RUNBOOK only if Dockerfiles / compose / CI workflows / a getting-started section were detected.
 - Include a PRD only if the repo's purpose obviously serves multiple user-facing capabilities.

Each doc's \`slug\` MUST start with \`auto-\` and be deterministic from \`type\` (e.g. \`auto-vision\`, \`auto-rfc-auth\`, \`auto-adr-prisma\`). Re-runs must produce IDENTICAL slugs.

Each doc's \`body\` is markdown. Use headings, bullets, and code blocks. Be concrete and reference real names from the summaries. NEVER output more than 400 words per doc.

Each doc's \`derivesFrom\` lists the repo-relative POSIX paths of the verbatim docs that grounded it (so we can write provenance edges back). Only list paths from the verbatim doc list — never paths from the code manifest.`;

export async function synthesizeDocs(
  input: SynthesizeInput,
): Promise<SynthesizedDocs> {
  const verbatimBlock = input.verbatimDocs
    .slice(0, 20)
    .map(
      (d) =>
        `### ${d.path} — ${d.title}\n${truncate(d.body, 1_500)}`,
    )
    .join("\n\n---\n\n");

  const summaryBlock = input.fileSummaries
    .slice(0, 120)
    .map(
      (s) =>
        `- ${s.path}\n  purpose: ${s.summary.purpose}\n  surface: ${s.summary.publicSurface.slice(0, 8).join(", ") || "—"}\n  deps: ${s.summary.deps.slice(0, 8).join(", ") || "—"}`,
    )
    .join("\n");

  const manifestBlock = input.manifest
    .slice(0, 100)
    .map((m) => `- ${m.path} (${m.kind}, ${m.bytes}b)`)
    .join("\n");

  const prompt =
    `# Verbatim docs (up to 20)\n${verbatimBlock || "_none_"}\n\n` +
    `# Per-file summaries (top 120 by walk order)\n${summaryBlock || "_none_"}\n\n` +
    `# Manifest (first 100 files)\n${manifestBlock}`;

  // Two-shot: first the SDK's structured-output (auto-mode); on parse failure
  // fall back to a plain text generation and strip the ```json fence the model
  // tends to add when its body content includes its own code fences. claude
  // via OpenRouter is observed to fence the whole response even with explicit
  // instructions otherwise, so we handle it on the consumer side.
  try {
    const { object } = await generateObject({
      model: input.model ?? languageModel("smart"),
      schema: synthesizedDocsSchema,
      system: SYSTEM,
      prompt,
    });
    return object as SynthesizedDocs;
  } catch {
    const { text } = await generateText({
      model: input.model ?? languageModel("smart"),
      system:
        SYSTEM +
        "\n\nReturn ONLY a JSON object matching this TypeScript shape:\n\n" +
        "type Out = { docs: Array<{ type: 'VISION'|'PRD'|'RFC'|'ADR'|'API_SPEC'|'DB_SCHEMA'|'WORKFLOW'|'RUNBOOK'; title: string; slug: string; body: string; derivesFrom: string[] }> }",
      prompt,
    });
    const parsed = synthesizedDocsSchema.parse(extractJson(text));
    return parsed;
  }
}

/**
 * Strip a leading ```json … ``` fence (or any first { … } JSON object) from a
 * text response. Models tend to fence structured output even when told not to;
 * we recover the JSON body on the client side rather than fight prompt
 * compliance.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Common case: ```json\n{...}\n```
  const fenceMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(trimmed);
  if (fenceMatch && fenceMatch[1]) {
    return JSON.parse(fenceMatch[1]);
  }
  // Fallback: greedy first-open / last-close.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  return JSON.parse(trimmed);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n…[truncated]";
}
