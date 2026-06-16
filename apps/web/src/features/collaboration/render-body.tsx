"use client";

import * as React from "react";

/**
 * Render a comment body, turning mention tokens (`@[label](user:id)` /
 * `@[label](agent:name)`) into styled @-chips. Pure presentational; the token
 * format is the same one core `parseMentions` consumes server-side.
 */
const TOKEN_RE = /@\[([^\]]+)\]\((user|agent):([^)]+)\)/g;

export function RenderBody({ body }: { body: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (match.index > last) {
      parts.push(<span key={key++}>{body.slice(last, match.index)}</span>);
    }
    const label = match[1]!;
    const kind = match[2]!;
    parts.push(
      <span
        key={key++}
        className={
          kind === "agent"
            ? "rounded bg-violet-500/15 px-1 font-medium text-violet-600 dark:text-violet-400"
            : "rounded bg-primary/10 px-1 font-medium text-primary"
        }
      >
        @{label}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < body.length) {
    parts.push(<span key={key++}>{body.slice(last)}</span>);
  }
  return <p className="whitespace-pre-wrap break-words text-sm">{parts}</p>;
}
