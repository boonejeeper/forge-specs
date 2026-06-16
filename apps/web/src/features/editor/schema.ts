import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
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
 */
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
});

export type ForgeSchema = typeof schema;
export type ForgeBlock = ForgeSchema["Block"];
