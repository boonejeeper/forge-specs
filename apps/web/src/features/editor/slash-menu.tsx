"use client";

import { Code2, Workflow, MessageSquareQuote, Network } from "lucide-react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";

import type { schema } from "./schema";
import { DIAGRAM_TEMPLATES } from "./diagram-templates";

type Editor = typeof schema.BlockNoteEditor;

/**
 * Slash-menu items for the custom blocks. Appended to BlockNote's defaults in
 * the editor. Each inserts/updates the current block to the custom type.
 */
export function customSlashItems(
  editor: Editor,
): DefaultReactSuggestionItem[] {
  const insertMermaid = (code: string) => {
    const ref = editor.getTextCursorPosition().block;
    editor.insertBlocks([{ type: "mermaid", props: { code } }], ref, "after");
  };

  return [
    {
      title: "Mermaid diagram",
      subtext: "Render a Mermaid diagram from text",
      aliases: ["mermaid", "diagram", "flowchart", "graph"],
      group: "Spec blocks",
      icon: <Workflow className="size-4" />,
      onItemClick: () => insertMermaid(""),
    },
    // Diagram-type ergonomics: each seeds a Mermaid block with a working starter
    // template for a common architecture diagram type (M9).
    ...DIAGRAM_TEMPLATES.map((tpl) => ({
      title: tpl.title,
      subtext: tpl.subtext,
      aliases: tpl.aliases,
      group: "Diagrams",
      icon: <Network className="size-4" />,
      onItemClick: () => insertMermaid(tpl.code),
    })),
    {
      title: "Code block",
      subtext: "Syntax-highlighted code",
      aliases: ["code", "snippet"],
      group: "Spec blocks",
      icon: <Code2 className="size-4" />,
      onItemClick: () => {
        const ref = editor.getTextCursorPosition().block;
        editor.insertBlocks(
          [{ type: "code", props: { code: "", language: "typescript" } }],
          ref,
          "after",
        );
      },
    },
    {
      title: "Callout",
      subtext: "Highlighted admonition",
      aliases: ["callout", "note", "info", "warning", "tip"],
      group: "Spec blocks",
      icon: <MessageSquareQuote className="size-4" />,
      onItemClick: () => {
        const ref = editor.getTextCursorPosition().block;
        editor.insertBlocks(
          [{ type: "callout", props: { variant: "info" } }],
          ref,
          "after",
        );
      },
    },
  ];
}
