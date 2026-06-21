import { z } from "zod";

/**
 * Structured-output schemas for the ingest AI stages.
 *
 * `fileSummarySchema` — fast model emits a short structured summary per code
 * file (purpose, public surface, key deps). Stored on RepoFile.summary as a
 * JSON-stringified record. Kept tight so we can feed many summaries into the
 * synthesis stage context window.
 *
 * `synthesizedDocsSchema` — smart model emits the canonical taxonomy as a flat
 * array of doc records (`type`, `title`, `slug`, `body`, `derivesFrom[]`). Body
 * is markdown — easier to LLM-author and easier to round-trip than BlockNote
 * JSON; the runner converts markdown to BlockNote-compatible content via the
 * existing block projection on save (paragraphs become text blocks).
 */

export const fileSummarySchema = z.object({
  purpose: z.string().describe("One-sentence summary of what this file does."),
  publicSurface: z
    .array(z.string())
    .max(20)
    .describe("Exported functions, classes, routes, or types — names only."),
  deps: z
    .array(z.string())
    .max(20)
    .describe(
      "Important external packages or sibling files this file depends on.",
    ),
});

export type FileSummary = z.infer<typeof fileSummarySchema>;

export const synthDocTypeEnum = z.enum([
  "VISION",
  "PRD",
  "RFC",
  "ADR",
  "API_SPEC",
  "DB_SCHEMA",
  "WORKFLOW",
  "RUNBOOK",
]);

export const synthesizedDocSchema = z.object({
  type: synthDocTypeEnum.describe("The canonical ForgeSpecs document type."),
  title: z.string().min(3).max(140),
  /** Stable slug — used by the runner to upsert on rerun. */
  slug: z
    .string()
    .regex(/^auto-[a-z0-9-]+$/)
    .describe(
      "Stable slug for upsert on rerun. Must start with 'auto-' and contain only lowercase, digits, and dashes.",
    ),
  body: z
    .string()
    .describe(
      "Markdown body. Use headings, bullets, code blocks. For API_SPEC include an OpenAPI yaml block; for DB_SCHEMA include a mermaid erDiagram block.",
    ),
  derivesFrom: z
    .array(z.string())
    .max(40)
    .describe(
      "Source repo file paths (POSIX, repo-relative) that ground this doc. Used to write DERIVES_FROM dependency edges back to the verbatim imports.",
    ),
});

export type SynthesizedDoc = z.infer<typeof synthesizedDocSchema>;

export const synthesizedDocsSchema = z.object({
  docs: z.array(synthesizedDocSchema).min(1).max(10),
});

export type SynthesizedDocs = z.infer<typeof synthesizedDocsSchema>;
