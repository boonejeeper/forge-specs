/**
 * A tiny markdown → BlockNote shape converter for the verbatim and synthesis
 * passes. We don't need a full markdown AST — just enough to lay out paragraphs,
 * headings, bullet lists, and code blocks so the BlockNote editor renders the
 * imported doc cleanly. Anything richer (tables, callouts, mermaid renderers)
 * survives as a code block, which BlockNote shows verbatim.
 *
 * NB: this is shape-compatible with what saveDocumentContent's projectBlocks
 * helper expects — top-level array of block objects with `type`, `content`,
 * `children`. The block projector tolerates unknown block types by surfacing
 * the JSON, so unsupported markdown isn't lost (it just renders as a literal).
 */

export type BlockNoteBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: Array<{ type: "text"; text: string; styles?: Record<string, unknown> }>;
  children?: BlockNoteBlock[];
};

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const BULLET_RE = /^[*-]\s+(.*)$/;
const NUMBERED_RE = /^\d+\.\s+(.*)$/;
const FENCE_RE = /^```(\w+)?\s*$/;

/**
 * Convert markdown to BlockNote-shaped blocks. The optional `idPrefix` is
 * stamped into each block's `id` so two documents converted in the same process
 * never collide on the Block table's globally-unique primary key. The runner
 * passes the target document slug as the prefix.
 */
function inlineText(text: string): NonNullable<BlockNoteBlock["content"]> {
  if (!text) return [];
  // BlockNote's TipTap layer rejects text content without a `styles` map,
  // even an empty one — matching the convention in genBlockToBlockNote().
  return [{ type: "text", text, styles: {} }];
}

export function markdownToBlockNote(md: string, idPrefix?: string): BlockNoteBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockNoteBlock[] = [];
  // BlockNote v0.20+ requires block ids be valid UUIDs (it rejects custom
  // formats during validation). Use crypto.randomUUID, falling back to a
  // deterministic random-ish suffix when randomUUID is unavailable.
  const nextId = (): string => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    // RFC4122-shaped fallback — random hex padded into the v4 layout.
    const r = Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
    return `${r.slice(0, 8)}-${r.slice(8, 12)}-4${r.slice(13, 16)}-a${r.slice(17, 20)}-${r.slice(20, 32)}`;
  };
  // idPrefix retained for backwards compatibility but no longer used — UUIDs
  // are globally unique on their own.
  void idPrefix;

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      const code = codeLines.join("\n");
      // Custom block specs in apps/web/src/features/editor/schema.ts: `mermaid`
      // gets its own block type (rendered via mermaid.js); everything else is
      // `code` (custom code block with language prop). The default `codeBlock`
      // is NOT registered, so emitting it crashes the client editor.
      if (lang.toLowerCase() === "mermaid") {
        blocks.push({
          id: nextId(),
          type: "mermaid",
          props: { code },
        });
      } else {
        blocks.push({
          id: nextId(),
          type: "code",
          props: { code, language: lang },
        });
      }
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading && heading[1] && heading[2] !== undefined) {
      const level = Math.min(3, heading[1].length);
      blocks.push({
        id: nextId(),
        type: "heading",
        props: { level },
        content: inlineText(heading[2]),
      });
      i++;
      continue;
    }

    if (BULLET_RE.test(line) || NUMBERED_RE.test(line)) {
      const items: BlockNoteBlock[] = [];
      const isNumbered = NUMBERED_RE.test(line);
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trimEnd();
        const m = isNumbered ? NUMBERED_RE.exec(cur) : BULLET_RE.exec(cur);
        if (!m || !m[1]) break;
        items.push({
          id: nextId(),
          type: isNumbered ? "numberedListItem" : "bulletListItem",
          content: inlineText(m[1]),
        });
        i++;
      }
      blocks.push(...items);
      continue;
    }

    // Plain paragraph: collect contiguous non-blank lines.
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = (lines[i] ?? "").trimEnd();
      if (!next.trim()) break;
      if (HEADING_RE.test(next) || BULLET_RE.test(next) || NUMBERED_RE.test(next) || FENCE_RE.test(next)) break;
      paraLines.push(next);
      i++;
    }
    blocks.push({
      id: nextId(),
      type: "paragraph",
      content: inlineText(paraLines.join(" ")),
    });
  }

  return blocks;
}
