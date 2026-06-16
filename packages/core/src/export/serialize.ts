/**
 * Pure serializers that turn a document's projected BlockNote body
 * (`contentJSON`) — plus its frontmatter and extracted acceptance criteria —
 * into the three formats an autonomous coding agent consumes:
 *
 *   - Markdown  (clean, GitHub-flavored, with a YAML frontmatter fence)
 *   - JSON      (a structured, machine-readable document envelope)
 *   - YAML      (the same envelope, YAML-serialized)
 *
 * Everything here is pure + dependency-light (only `yaml`) so it unit-tests and
 * runs identically in the export route handler and the agent-bundle assembler.
 *
 * The BlockNote block shape mirrors core `block-content.ts`: each block is
 *   { id?, type, props?, content?, children? }
 * where custom blocks (mermaid/code) carry their payload in `props.code` /
 * `props.language`, and ordinary blocks carry inline content nodes.
 */
import { stringify as stringifyYaml } from "yaml";

import {
  type BlockNoteBlock,
  type InlineContentNode,
} from "../documents/block-content";

// ── document metadata + frontmatter ─────────────────────────────────────────

/** The agent-readiness frontmatter we surface in every export. */
export interface ExportFrontmatter {
  status?: string;
  owner?: string;
  version?: string;
  implementation_state?: string;
  [key: string]: unknown;
}

/** A single document to serialize (the seed or a closure member). */
export interface ExportDocument {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  frontmatter: ExportFrontmatter;
  /** BlockNote document JSON (array of blocks). */
  contentJSON: unknown;
  /** Acceptance criteria extracted from the body (see extractAcceptanceCriteria). */
  acceptanceCriteria: string[];
  /**
   * For API_SPEC docs: the extracted OpenAPI source + format.
   * For DB_SCHEMA docs: the extracted DBML + (optional) generated SQL.
   * Populated by the route/bundle layer (which owns the M9 extractors).
   */
  openapi?: { source: string; format: "yaml" | "json" } | null;
  dbml?: { source: string; sql?: string } | null;
}

// ── inline + block → Markdown ───────────────────────────────────────────────

function escapeMarkdown(text: string): string {
  // Minimal escaping so structural characters in prose don't break rendering.
  return text.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

/** Render an inline content array (text/links/mentions) to Markdown text. */
function inlineToMarkdown(nodes: InlineContentNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node.text === "string") {
      const styles = (node as { styles?: Record<string, unknown> }).styles ?? {};
      let t = escapeMarkdown(node.text);
      if (styles.code) t = `\`${node.text}\``; // code spans are not escaped
      else {
        if (styles.bold) t = `**${t}**`;
        if (styles.italic) t = `*${t}*`;
      }
      out += t;
    } else if (node.type === "link") {
      const label = Array.isArray(node.content)
        ? inlineToMarkdown(node.content)
        : typeof node.content === "string"
          ? node.content
          : "";
      const href =
        node.props && typeof node.props.href === "string" ? node.props.href : "";
      out += href ? `[${label}](${href})` : label;
    } else if (Array.isArray(node.content)) {
      out += inlineToMarkdown(node.content);
    } else if (typeof node.content === "string") {
      out += escapeMarkdown(node.content);
    } else if (node.props && typeof node.props.label === "string") {
      // Custom inline (e.g. @mention) — surface its label.
      out += `@${node.props.label}`;
    }
  }
  return out;
}

function inlineContentOf(block: BlockNoteBlock): InlineContentNode[] {
  return Array.isArray(block.content) ? (block.content as InlineContentNode[]) : [];
}

function headingLevel(block: BlockNoteBlock): number {
  const lvl = block.props?.level;
  if (typeof lvl === "number" && lvl >= 1 && lvl <= 6) return lvl;
  return 2;
}

/**
 * Render a single block (and its children) to Markdown lines. `depth` controls
 * list indentation; `index` carries the ordinal for numbered list items.
 */
function blockToMarkdown(
  block: BlockNoteBlock,
  depth: number,
  index: number,
): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  const type = typeof block.type === "string" ? block.type : "paragraph";
  const code = block.props?.code;

  switch (type) {
    case "heading": {
      lines.push(`${"#".repeat(headingLevel(block))} ${inlineToMarkdown(inlineContentOf(block))}`);
      break;
    }
    case "bulletListItem":
    case "checkListItem": {
      const checked = block.props?.checked === true;
      const marker = type === "checkListItem" ? `- [${checked ? "x" : " "}] ` : "- ";
      lines.push(`${indent}${marker}${inlineToMarkdown(inlineContentOf(block))}`);
      break;
    }
    case "numberedListItem": {
      lines.push(`${indent}${index + 1}. ${inlineToMarkdown(inlineContentOf(block))}`);
      break;
    }
    case "quote": {
      lines.push(`> ${inlineToMarkdown(inlineContentOf(block))}`);
      break;
    }
    case "code": {
      const lang =
        typeof block.props?.language === "string" ? block.props.language : "";
      lines.push("```" + lang);
      lines.push(typeof code === "string" ? code : "");
      lines.push("```");
      break;
    }
    case "mermaid": {
      lines.push("```mermaid");
      lines.push(typeof code === "string" ? code : "");
      lines.push("```");
      break;
    }
    case "table": {
      // Tables carry their structure in content; fall back to plain text.
      const text = inlineToMarkdown(inlineContentOf(block));
      if (text) lines.push(text);
      break;
    }
    case "paragraph":
    default: {
      const text = inlineToMarkdown(inlineContentOf(block));
      // Preserve empty paragraphs as blank separators (handled by the joiner).
      lines.push(text);
      break;
    }
  }

  // Children (nested lists / nested blocks).
  if (Array.isArray(block.children) && block.children.length > 0) {
    block.children.forEach((child, i) => {
      lines.push(...blockToMarkdown(child, depth + 1, i));
    });
  }

  return lines;
}

/** Block types that read better with a blank line around them. */
const BLOCK_BREAK = new Set(["heading", "code", "mermaid", "quote", "table"]);

/** Convert a BlockNote document array to clean Markdown (body only). */
export function blocknoteToMarkdown(doc: unknown): string {
  if (!Array.isArray(doc)) return "";
  const out: string[] = [];
  (doc as BlockNoteBlock[]).forEach((block, index) => {
    const type = typeof block.type === "string" ? block.type : "paragraph";
    const lines = blockToMarkdown(block, 0, index);
    const rendered = lines.join("\n").trimEnd();
    if (rendered.length === 0) {
      // Empty paragraph → blank line (but collapse runs of them).
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      return;
    }
    if (BLOCK_BREAK.has(type) && out.length > 0 && out[out.length - 1] !== "") {
      out.push("");
    }
    out.push(rendered);
    if (BLOCK_BREAK.has(type)) out.push("");
  });
  // Collapse trailing blank lines.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// ── acceptance criteria extraction ──────────────────────────────────────────

function blockPlainText(block: BlockNoteBlock): string {
  return inlineToMarkdown(inlineContentOf(block))
    .replace(/[\\*_`]/g, "")
    .trim();
}

/**
 * Pull "acceptance criteria" out of a BlockNote body. The convention (matching
 * M7 generation, see ai sections.ts) is a heading whose text contains
 * "acceptance criteria", followed by list items. We collect the list items
 * (and any nested ones) until the next heading.
 */
export function extractAcceptanceCriteria(doc: unknown): string[] {
  if (!Array.isArray(doc)) return [];
  const blocks = doc as BlockNoteBlock[];
  const out: string[] = [];

  const collectListItems = (block: BlockNoteBlock): void => {
    const t = block.type;
    if (t === "bulletListItem" || t === "numberedListItem" || t === "checkListItem") {
      const text = blockPlainText(block);
      if (text) out.push(text);
    }
    if (Array.isArray(block.children)) {
      for (const c of block.children) collectListItems(c);
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type !== "heading") continue;
    const headingText = blockPlainText(block).toLowerCase();
    if (!headingText.includes("acceptance criteria")) continue;
    // Collect following blocks until the next heading.
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j]!;
      if (next.type === "heading") break;
      collectListItems(next);
    }
  }

  return out;
}

// ── structured JSON / YAML envelope ─────────────────────────────────────────

/** A structured, machine-readable document (the JSON/YAML projection). */
export interface DocumentExport {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  frontmatter: ExportFrontmatter;
  acceptanceCriteria: string[];
  /** Clean Markdown of the body — the canonical agent-readable form. */
  markdown: string;
  openapi?: { source: string; format: "yaml" | "json" } | null;
  dbml?: { source: string; sql?: string } | null;
}

/** Project an ExportDocument into the structured envelope (shared by JSON+YAML). */
export function toDocumentExport(doc: ExportDocument): DocumentExport {
  const out: DocumentExport = {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    type: doc.type,
    status: doc.status,
    frontmatter: doc.frontmatter ?? {},
    acceptanceCriteria: doc.acceptanceCriteria ?? [],
    markdown: blocknoteToMarkdown(doc.contentJSON),
  };
  if (doc.openapi) out.openapi = doc.openapi;
  if (doc.dbml) out.dbml = doc.dbml;
  return out;
}

// ── single-document serializers ─────────────────────────────────────────────

function frontmatterFor(doc: ExportDocument): ExportFrontmatter {
  // Status on the document row is authoritative; merge it over stored frontmatter
  // so the export always reflects the live status.
  return {
    status: doc.status,
    ...doc.frontmatter,
    // ensure status isn't shadowed by a stale frontmatter.status
    ...(doc.frontmatter?.status ? {} : {}),
  };
}

/** Serialize one document to Markdown with a YAML frontmatter fence. */
export function documentToMarkdown(doc: ExportDocument): string {
  const fm = frontmatterFor(doc);
  const parts: string[] = [];

  // YAML frontmatter fence.
  parts.push("---");
  parts.push(
    stringifyYaml({
      title: doc.title,
      slug: doc.slug,
      type: doc.type,
      ...fm,
    }).trimEnd(),
  );
  parts.push("---");
  parts.push("");

  const body = blocknoteToMarkdown(doc.contentJSON);
  if (body) {
    parts.push(body);
    parts.push("");
  }

  if (doc.acceptanceCriteria.length > 0) {
    parts.push("## Acceptance Criteria");
    parts.push("");
    for (const c of doc.acceptanceCriteria) parts.push(`- ${c}`);
    parts.push("");
  }

  if (doc.openapi) {
    parts.push("## OpenAPI");
    parts.push("");
    parts.push("```" + doc.openapi.format);
    parts.push(doc.openapi.source.trim());
    parts.push("```");
    parts.push("");
  }

  if (doc.dbml) {
    parts.push("## Database Schema (DBML)");
    parts.push("");
    parts.push("```dbml");
    parts.push(doc.dbml.source.trim());
    parts.push("```");
    parts.push("");
    if (doc.dbml.sql) {
      parts.push("### Generated SQL");
      parts.push("");
      parts.push("```sql");
      parts.push(doc.dbml.sql.trim());
      parts.push("```");
      parts.push("");
    }
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Serialize one document to the structured JSON string. */
export function documentToJson(doc: ExportDocument): string {
  return JSON.stringify(toDocumentExport(doc), null, 2) + "\n";
}

/** Serialize one document to YAML. */
export function documentToYaml(doc: ExportDocument): string {
  return stringifyYaml(toDocumentExport(doc));
}
