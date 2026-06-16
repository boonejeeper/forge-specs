"use client";

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * Mermaid diagram block. The source lives in `props.code`; the rendered SVG is
 * derived (never persisted). `mermaid` is heavy and pulls in a parser + d3, so
 * it is lazy-imported only when a Mermaid block actually mounts — keeping it off
 * the hot editor path.
 */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

let renderSeq = 0;

function MermaidView({
  code,
  editable,
  onChange,
}: {
  code: string;
  editable: boolean;
  onChange: (code: string) => void;
}) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    const source = code.trim();
    if (!source) {
      setSvg(null);
      setError(null);
      return;
    }
    let cancelled = false;
    // Debounce so we don't re-render on every keystroke.
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const id = `mermaid-${renderSeq++}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : "Failed to render diagram.");
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  const showEditor = editable && (editing || (!svg && !error));

  return (
    <div
      className="my-1 w-full overflow-hidden rounded-md border bg-muted/30"
      data-mermaid-block
    >
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Mermaid</span>
        {editable ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setEditing((v) => !v)}
          >
            {showEditor ? "Preview" : "Edit"}
          </button>
        ) : null}
      </div>

      {showEditor ? (
        <textarea
          className="w-full resize-y bg-transparent p-3 font-mono text-sm outline-none"
          rows={Math.max(4, code.split("\n").length)}
          value={code}
          spellCheck={false}
          placeholder="graph TD;\n  A --> B"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : error ? (
        <div className="p-3">
          <p className="text-xs font-medium text-destructive">Diagram error</p>
          <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
            {error}
          </pre>
        </div>
      ) : svg ? (
        <div
          className="flex justify-center p-3 [&_svg]:max-w-full"
          // Mermaid output is sanitized by its strict security level.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="p-3 text-xs text-muted-foreground">Empty diagram.</div>
      )}
    </div>
  );
}

export const mermaidBlock = createReactBlockSpec(
  {
    type: "mermaid",
    propSchema: {
      code: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <MermaidView
        code={block.props.code}
        editable={editor.isEditable}
        onChange={(code) =>
          editor.updateBlock(block, { type: "mermaid", props: { code } })
        }
      />
    ),
  },
);
