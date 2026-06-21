import * as React from "react";
import Link from "next/link";

/**
 * Tiny markdown → React renderer for the runbook pages. Handles the subset of
 * markdown the guide content uses: H1/H2/H3, paragraphs, unordered and ordered
 * lists, code blocks (fenced), inline code, links, and bold/italic. We avoid
 * pulling in react-markdown + remark-gfm to keep the marketing bundle slim.
 *
 * If the docs ever need tables, footnotes, or images, swap this for
 * react-markdown — the rest of the page only depends on the rendered React tree.
 */

export function renderMarkdown(md: string): React.JSX.Element {
  return <>{renderBlocks(parseBlocks(md))}</>;
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; text: string };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    if (!raw.trim()) {
      i++;
      continue;
    }
    const fence = /^```(\w+)?\s*$/.exec(raw);
    if (fence) {
      const language = fence[1] ?? "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      out.push({ kind: "code", language, text: buf.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(raw);
    if (heading && heading[1] && heading[2] !== undefined) {
      out.push({
        kind: "heading",
        level: Math.min(3, heading[1].length) as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(raw) || /^\d+\.\s+/.test(raw)) {
      const ordered = /^\d+\.\s+/.test(raw);
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const m = ordered ? /^\d+\.\s+(.*)$/.exec(cur) : /^[-*]\s+(.*)$/.exec(cur);
        if (!m || !m[1]) break;
        items.push(m[1]);
        i++;
      }
      out.push({ kind: "list", ordered, items });
      continue;
    }
    // Paragraph: collect contiguous non-blank lines that don't start a new block.
    const buf: string[] = [raw];
    i++;
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (!cur.trim()) break;
      if (/^(#{1,3})\s+/.test(cur) || /^[-*]\s+/.test(cur) || /^\d+\.\s+/.test(cur) || /^```/.test(cur)) {
        break;
      }
      buf.push(cur);
      i++;
    }
    out.push({ kind: "paragraph", text: buf.join(" ") });
  }
  return out;
}

function renderBlocks(blocks: Block[]): React.JSX.Element[] {
  return blocks.map((b, idx) => {
    if (b.kind === "heading") {
      const id = slugifyAnchor(b.text);
      const className =
        b.level === 1
          ? "mt-8 text-2xl font-semibold tracking-tight"
          : b.level === 2
            ? "group mt-8 text-xl font-semibold tracking-tight"
            : "group mt-6 text-base font-semibold tracking-tight";
      const inner = (
        <a href={`#${id}`} className="no-underline hover:underline">
          {renderInline(b.text)}
        </a>
      );
      switch (b.level) {
        case 1:
          return (
            <h1 key={idx} id={id} className={className}>
              {inner}
            </h1>
          );
        case 2:
          return (
            <h2 key={idx} id={id} className={className}>
              {inner}
            </h2>
          );
        default:
          return (
            <h3 key={idx} id={id} className={className}>
              {inner}
            </h3>
          );
      }
    }
    if (b.kind === "paragraph") {
      return (
        <p key={idx} className="mt-3 leading-relaxed text-foreground/90">
          {renderInline(b.text)}
        </p>
      );
    }
    if (b.kind === "list") {
      const items = b.items.map((it, j) => (
        <li key={j} className="mt-1.5 leading-relaxed">
          {renderInline(it)}
        </li>
      ));
      return b.ordered ? (
        <ol key={idx} className="mt-3 list-decimal space-y-1 pl-6">
          {items}
        </ol>
      ) : (
        <ul key={idx} className="mt-3 list-disc space-y-1 pl-6">
          {items}
        </ul>
      );
    }
    return (
      <pre
        key={idx}
        className="mt-4 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs"
      >
        <code>{b.text}</code>
      </pre>
    );
  });
}

/** Inline parser: links, bold, italic, inline code. Order-sensitive. */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    // Inline code: `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        nodes.push(
          <code
            key={key++}
            className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono"
          >
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    // Link: [label](href)
    if (text[i] === "[") {
      const labelEnd = text.indexOf("](", i + 1);
      if (labelEnd !== -1) {
        const closeParen = text.indexOf(")", labelEnd + 2);
        if (closeParen !== -1) {
          const label = text.slice(i + 1, labelEnd);
          const href = text.slice(labelEnd + 2, closeParen);
          const isInternal = href.startsWith("/") || href.startsWith("#");
          const linkClass = "font-medium text-primary underline-offset-4 hover:underline";
          nodes.push(
            isInternal && !href.startsWith("#") ? (
              <Link key={key++} href={href} className={linkClass}>
                {renderInline(label)}
              </Link>
            ) : (
              <a
                key={key++}
                href={href}
                className={linkClass}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel={href.startsWith("http") ? "noreferrer" : undefined}
              >
                {renderInline(label)}
              </a>
            ),
          );
          i = closeParen + 1;
          continue;
        }
      }
    }
    // Bold: **text**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        nodes.push(
          <strong key={key++} className="font-semibold">
            {renderInline(text.slice(i + 2, end))}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    // Italic: *text*  (rough: not after a word char to avoid file-name.* etc.)
    if (text[i] === "*" && text[i - 1] !== "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        nodes.push(
          <em key={key++} className="italic">
            {renderInline(text.slice(i + 1, end))}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    // Plain text run up to the next special char.
    let j = i;
    while (j < text.length) {
      const c = text[j];
      if (c === "`" || c === "[" || c === "*") break;
      j++;
    }
    nodes.push(<React.Fragment key={key++}>{text.slice(i, j)}</React.Fragment>);
    i = j;
  }
  return nodes;
}

function slugifyAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
