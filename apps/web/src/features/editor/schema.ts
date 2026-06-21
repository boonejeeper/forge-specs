import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";

import { mermaidBlock } from "./blocks/MermaidBlock";
import { codeBlock } from "./blocks/CodeBlock";
import { calloutBlock } from "./blocks/CalloutBlock";
import { mentionInline } from "./mentions/MentionInline";

/**
 * The ForgeSpecs editor schema: all default BlockNote blocks plus our custom
 * spec-authoring blocks (Mermaid diagrams, syntax-highlighted Code, Callouts)
 * and the inline @mention.
 *
 * Defined once and shared by the editor instance, the slash-menu items, and any
 * server-side parsing — so the document shape is identical everywhere.
 *
 * styleSpecs note: BlockNote's default inline style `code` (Ctrl+E for inline
 * code) registers a TipTap mark named `code`, which COLLIDES with our custom
 * block-level `code` block (also a TipTap node named `code`). The duplicate
 * tripped TipTap's "Duplicate extension names" check, which then broke
 * editor construction on every spec page. We drop the inline `code` style — a
 * deliberate trade-off keeping the syntax-highlighted code BLOCK (the spec
 * authoring affordance) and losing inline `code` (rarely used in specs).
 */
const { code: _droppedCodeStyle, ...styleSpecsWithoutInlineCode } =
  defaultStyleSpecs;
void _droppedCodeStyle;

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    // createReactBlockSpec returns a factory; call it to get the BlockSpec.
    mermaid: mermaidBlock(),
    code: codeBlock(),
    callout: calloutBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: mentionInline,
  },
  styleSpecs: styleSpecsWithoutInlineCode,
});

export type ForgeSchema = typeof schema;
export type ForgeBlock = ForgeSchema["Block"];
