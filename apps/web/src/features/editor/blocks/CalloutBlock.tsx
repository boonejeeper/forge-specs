"use client";

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Info, AlertTriangle, CheckCircle2, Lightbulb } from "lucide-react";

/**
 * Callout block — an admonition with editable inline content (so it participates
 * in normal text editing, mentions, marks). The `type` prop selects the variant;
 * the body is real BlockNote inline content (content: "inline").
 */

type CalloutVariant = "info" | "warning" | "success" | "tip";

const VARIANTS: Record<
  CalloutVariant,
  { icon: typeof Info; className: string; label: string }
> = {
  info: {
    icon: Info,
    label: "Info",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  warning: {
    icon: AlertTriangle,
    label: "Warning",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  success: {
    icon: CheckCircle2,
    label: "Success",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  tip: {
    icon: Lightbulb,
    label: "Tip",
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
};

const ORDER: CalloutVariant[] = ["info", "warning", "success", "tip"];

export const calloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      variant: { default: "info", values: ORDER },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const variant = (block.props.variant as CalloutVariant) ?? "info";
      const meta = VARIANTS[variant] ?? VARIANTS.info;
      const Icon = meta.icon;
      const cycle = () => {
        const next = ORDER[(ORDER.indexOf(variant) + 1) % ORDER.length]!;
        editor.updateBlock(block, { type: "callout", props: { variant: next } });
      };
      return (
        <div
          className={`my-1 flex w-full gap-3 rounded-md border px-3 py-2.5 ${meta.className}`}
          data-callout-block
        >
          <button
            type="button"
            aria-label={`Callout: ${meta.label} (click to change)`}
            className="mt-0.5 shrink-0"
            contentEditable={false}
            onClick={editor.isEditable ? cycle : undefined}
            disabled={!editor.isEditable}
          >
            <Icon className="size-4" />
          </button>
          <div className="min-w-0 flex-1 text-foreground" ref={contentRef} />
        </div>
      );
    },
  },
);
