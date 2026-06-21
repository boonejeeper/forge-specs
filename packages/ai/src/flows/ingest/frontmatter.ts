/**
 * Minimal markdown frontmatter parser. Handles the conventional shape:
 *
 *     ---
 *     key: value
 *     other: thing
 *     ---
 *     <body>
 *
 * We only need primitive scalars (title, type, status) for the verbatim pass —
 * not arrays, anchors, or nested maps — so a hand-rolled splitter beats pulling
 * in gray-matter just for this. Returns the raw body when no frontmatter is
 * present.
 */

export interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

const FENCE = /^---\s*\r?\n/;

export function parseFrontmatter(input: string): ParsedMarkdown {
  if (!FENCE.test(input)) {
    return { frontmatter: {}, body: input };
  }
  const afterOpen = input.replace(FENCE, "");
  const closeIdx = afterOpen.search(/\r?\n---\s*(\r?\n|$)/);
  if (closeIdx === -1) {
    return { frontmatter: {}, body: input };
  }
  const fmRaw = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx).replace(/^\r?\n---\s*\r?\n?/, "");

  const frontmatter: Record<string, string> = {};
  for (const lineRaw of fmRaw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body };
}

/** Pull a likely title from a markdown body — first `# heading` line, or null. */
export function titleFromMarkdown(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}
