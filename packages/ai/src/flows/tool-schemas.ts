/**
 * Zod input schemas for the chat tools. Kept in their own module — separate from
 * the flow that binds `execute` to live data — so they are PURE and unit-testable
 * (the test suite asserts on shape/validation without any DB or provider), and so
 * the route + the UI confirmation cards can share the exact same contracts.
 *
 * `proposeEdit` is the one tool the model cannot execute autonomously: it returns
 * a STRUCTURED proposal the UI confirms, and on confirm the client routes it
 * through the M5 `createSuggestion` server action (diff → Suggestion). The AI
 * never writes Postgres-of-record directly — same human mutation path, full audit.
 */
import { z } from "zod";

export const searchSpecsInput = z.object({
  query: z
    .string()
    .min(1)
    .describe("Natural-language or keyword query over the spec corpus."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe("Maximum number of documents to return."),
});
export type SearchSpecsInput = z.infer<typeof searchSpecsInput>;

export const getDocumentInput = z.object({
  documentId: z.string().min(1).describe("Id of the document to fetch."),
});
export type GetDocumentInput = z.infer<typeof getDocumentInput>;

export const getDependenciesInput = z.object({
  documentId: z.string().min(1).describe("Document whose graph to inspect."),
  direction: z
    .enum(["incoming", "outgoing", "both"])
    .default("both")
    .describe(
      "outgoing = what this depends on; incoming = what depends on it; both = union.",
    ),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(6)
    .default(2)
    .describe("Hop limit for the transitive closure."),
});
export type GetDependenciesInput = z.infer<typeof getDependenciesInput>;

export const proposeEditInput = z.object({
  documentId: z
    .string()
    .min(1)
    .describe("Document the edit targets (defaults to the current doc)."),
  /**
   * The model proposes the FULL revised text of a section/block, not a diff —
   * the client computes the jsondiffpatch delta against the live body via core
   * `diffSuggestion` and submits it through `createSuggestion`. Free-form text
   * keeps the model's job simple and the delta computation deterministic.
   */
  blockId: z
    .string()
    .optional()
    .describe("Block to replace; omit to append a new block."),
  proposedText: z
    .string()
    .min(1)
    .describe("The full proposed text for the targeted block/section."),
  rationale: z
    .string()
    .optional()
    .describe("Short explanation shown to the reviewer."),
});
export type ProposeEditInput = z.infer<typeof proposeEditInput>;
