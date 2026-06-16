"use client";

import { createReactInlineContentSpec } from "@blocknote/react";

/**
 * Inline @mention. Two kinds:
 *   - user  → references a project member (resolved from membership)
 *   - agent → a marker for later AI (M6/M7). Rendered distinctly; inert for now.
 *
 * `label` carries the display text (e.g. "@alice") so the plaintext flattener
 * can surface it for search. `id` is the user id, or an agent key.
 */
export const mentionInline = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      id: { default: "" },
      label: { default: "" },
      kind: { default: "user", values: ["user", "agent"] },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const isAgent = inlineContent.props.kind === "agent";
      return (
        <span
          data-mention
          data-kind={inlineContent.props.kind}
          className={
            isAgent
              ? "rounded bg-violet-500/15 px-1 font-medium text-violet-700 dark:text-violet-300"
              : "rounded bg-blue-500/15 px-1 font-medium text-blue-700 dark:text-blue-300"
          }
        >
          {inlineContent.props.label}
        </span>
      );
    },
  },
);
