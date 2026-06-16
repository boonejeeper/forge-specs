/**
 * BlockNote-compatible block schema for generated content + helpers to turn a
 * model's structured output into a BlockNote document array.
 *
 * The editor's source of truth is an array of BlockNote blocks (see core
 * `block-content.ts`). Asking an LLM to emit raw BlockNote JSON (ids, styles,
 * props) is brittle: it omits ids, mangles `styles`, and invents block types.
 * Instead, flows emit a FLAT, LLM-friendly schema (a list of typed nodes with a
 * `text`/`code`/`level`) and we deterministically materialize that into valid
 * BlockNote blocks here — including custom Mermaid/Code blocks the editor knows.
 *
 * Pure + dependency-free so it is unit-tested and reusable in both the streaming
 * route (incremental) and the resumable job (batch) without a provider.
 */
import { z } from "zod";

/** The block "kinds" the generator may emit. Mapped to BlockNote types below. */
export const genBlockSchema = z.object({
  /**
   * heading | paragraph | bullet | numbered | quote | code | mermaid
   * Kept small + explicit so the model can't invent unsupported block types.
   */
  kind: z.enum([
    "heading",
    "paragraph",
    "bullet",
    "numbered",
    "quote",
    "code",
    "mermaid",
  ]),
  /** Visible text (paragraph/heading/list/quote) — ignored for code/mermaid. */
  text: z.string().default(""),
  /** Heading level 1–3 (only meaningful for kind=heading). */
  level: z.number().int().min(1).max(3).optional(),
  /** Source for code / mermaid blocks. */
  code: z.string().optional(),
  /** Language hint for code blocks (e.g. "ts", "sql", "yaml"). */
  language: z.string().optional(),
});
export type GenBlock = z.infer<typeof genBlockSchema>;

/** A whole generated document body — an ordered list of generator blocks. */
export const genBlocksSchema = z.array(genBlockSchema);
export type GenBlocks = z.infer<typeof genBlocksSchema>;

/** A minimal BlockNote block (loosely typed — matches core block-content). */
export interface BlockNoteBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: { type: "text"; text: string; styles: Record<string, unknown> }[];
  children?: BlockNoteBlock[];
}

function inlineText(text: string): BlockNoteBlock["content"] {
  if (!text) return [];
  return [{ type: "text", text, styles: {} }];
}

/**
 * Convert one generator block into a BlockNote block. Unknown/empty inputs are
 * coerced to a paragraph so materialization never produces an invalid block.
 *
 * Mermaid + Code map to the custom block types registered in the editor schema
 * (apps/web features/editor/schema.ts: `mermaid` carries `props.code`; `code`
 * carries `props.code` + `props.language`).
 */
export function genBlockToBlockNote(block: GenBlock): BlockNoteBlock {
  switch (block.kind) {
    case "heading":
      return {
        type: "heading",
        props: { level: block.level ?? 2 },
        content: inlineText(block.text),
      };
    case "bullet":
      return { type: "bulletListItem", content: inlineText(block.text) };
    case "numbered":
      return { type: "numberedListItem", content: inlineText(block.text) };
    case "quote":
      return { type: "quote", content: inlineText(block.text) };
    case "code":
      return {
        type: "code",
        props: { code: block.code ?? block.text ?? "", language: block.language ?? "" },
      };
    case "mermaid":
      return {
        type: "mermaid",
        props: { code: block.code ?? block.text ?? "" },
      };
    case "paragraph":
    default:
      return { type: "paragraph", content: inlineText(block.text) };
  }
}

/** Materialize a list of generator blocks into a BlockNote document array. */
export function genBlocksToBlockNote(blocks: GenBlocks): BlockNoteBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    // Never seed an empty doc — BlockNote needs at least one block.
    return [{ type: "paragraph", content: [] }];
  }
  return blocks.map(genBlockToBlockNote);
}
