/**
 * A tiny, dependency-free BlockNote materializer for template seed content.
 *
 * Templates are authored as a compact, flat list of "seed blocks" (heading /
 * paragraph / bullet / code / mermaid) — the same friendly shape M7 generation
 * uses — and deterministically materialized into valid BlockNote blocks here.
 * Kept in core (not @forgespecs/ai) so the seed script and applyTemplate share
 * one definition without a cross-package dependency.
 */

export interface SeedBlock {
  kind: "heading" | "paragraph" | "bullet" | "numbered" | "quote" | "code" | "mermaid";
  text?: string;
  level?: 1 | 2 | 3;
  code?: string;
  language?: string;
}

export interface MaterializedBlock {
  type: string;
  props?: Record<string, unknown>;
  content?: { type: "text"; text: string; styles: Record<string, unknown> }[];
}

function inlineText(text: string): MaterializedBlock["content"] {
  if (!text) return [];
  return [{ type: "text", text, styles: {} }];
}

function seedBlockToBlockNote(block: SeedBlock): MaterializedBlock {
  switch (block.kind) {
    case "heading":
      return {
        type: "heading",
        props: { level: block.level ?? 2 },
        content: inlineText(block.text ?? ""),
      };
    case "bullet":
      return { type: "bulletListItem", content: inlineText(block.text ?? "") };
    case "numbered":
      return { type: "numberedListItem", content: inlineText(block.text ?? "") };
    case "quote":
      return { type: "quote", content: inlineText(block.text ?? "") };
    case "code":
      return {
        type: "code",
        props: { code: block.code ?? block.text ?? "", language: block.language ?? "" },
      };
    case "mermaid":
      return { type: "mermaid", props: { code: block.code ?? block.text ?? "" } };
    case "paragraph":
    default:
      return { type: "paragraph", content: inlineText(block.text ?? "") };
  }
}

/** Materialize a flat seed-block list into a BlockNote document array. */
export function seedBlocksToBlockNote(blocks: SeedBlock[]): MaterializedBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [{ type: "paragraph", content: [] }];
  }
  return blocks.map(seedBlockToBlockNote);
}
