"use client";

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * Code block with Shiki syntax highlighting for the read path and a plain
 * <textarea> for editing (the lighter path vs. CodeMirror — no extra editor
 * runtime, and the textarea degrades gracefully). Shiki is lazy-loaded only when
 * a code block mounts, and we load just the languages we need on demand.
 *
 * Source lives in `props.code`; `props.language` selects the grammar.
 */

const LANGUAGES = [
  "typescript",
  "javascript",
  "tsx",
  "json",
  "bash",
  "python",
  "go",
  "rust",
  "sql",
  "yaml",
  "markdown",
  "prisma",
  "html",
  "css",
] as const;

type Highlighter = Awaited<ReturnType<typeof import("shiki")["createHighlighter"]>>;

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: [...LANGUAGES],
      }),
    );
  }
  return highlighterPromise;
}

function CodeView({
  code,
  language,
  editable,
  onChange,
  onLanguageChange,
}: {
  code: string;
  language: string;
  editable: boolean;
  onChange: (code: string) => void;
  onLanguageChange: (language: string) => void;
}) {
  const [html, setHtml] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (editing) return;
    if (!code.trim()) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const hl = await getHighlighter();
        const lang = (LANGUAGES as readonly string[]).includes(language)
          ? language
          : "text";
        const out = hl.codeToHtml(code, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
        if (!cancelled) setHtml(out);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language, editing]);

  return (
    <div className="my-1 w-full overflow-hidden rounded-md border bg-muted/30" data-code-block>
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5">
        {editable ? (
          <select
            className="bg-transparent text-xs text-muted-foreground outline-none"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{language}</span>
        )}
        {editable ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>

      {editable && (editing || !html) ? (
        <textarea
          className="w-full resize-y bg-transparent p-3 font-mono text-sm leading-relaxed outline-none"
          rows={Math.max(3, code.split("\n").length)}
          value={code}
          spellCheck={false}
          placeholder="// code"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setEditing(true)}
        />
      ) : html ? (
        <div
          className="overflow-x-auto p-3 text-sm [&_pre]:!bg-transparent [&_pre]:!m-0"
          // Shiki produces a static, sanitized <pre> tree from the source text.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-sm">{code}</pre>
      )}
    </div>
  );
}

export const codeBlock = createReactBlockSpec(
  {
    type: "code",
    propSchema: {
      code: { default: "" },
      language: { default: "typescript" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <CodeView
        code={block.props.code}
        language={block.props.language}
        editable={editor.isEditable}
        onChange={(code) =>
          editor.updateBlock(block, {
            type: "code",
            props: { code, language: block.props.language },
          })
        }
        onLanguageChange={(language) =>
          editor.updateBlock(block, {
            type: "code",
            props: { code: block.props.code, language },
          })
        }
      />
    ),
  },
);
