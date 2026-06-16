/**
 * Pure helpers for working with BlockNote document JSON — the editor's content
 * is the source of truth for the doc body in M2 (single-player). These are
 * process-agnostic and dependency-free so they can run in the web Server Action
 * today and, in M4, in the collab compaction path that derives the same
 * projection from the Yjs document.
 *
 * BlockNote's document is an ordered array of blocks. Each block has:
 *   { id, type, props, content?, children? }
 * where `content` is either an array of inline content nodes (text / links /
 * custom inline like mentions) or, for some block types, a nested structure.
 * We treat content defensively because custom blocks (Mermaid, Code, Callout)
 * carry their payload in `props`, not inline `content`.
 */

/** A single inline content node (text, link, or custom inline like a mention). */
export interface InlineContentNode {
  type?: string;
  text?: string;
  /** Links wrap further inline content. */
  content?: InlineContentNode[] | string;
  /** Custom inline props (e.g. mentions carry the label here). */
  props?: Record<string, unknown>;
}

/** A BlockNote block node (loosely typed — we only read what we project). */
export interface BlockNoteBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: InlineContentNode[] | { type: string; [k: string]: unknown } | string;
  children?: BlockNoteBlock[];
}

/** The top-level BlockNote document: an array of blocks. */
export type BlockNoteDocument = BlockNoteBlock[];

function inlineToText(nodes: InlineContentNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node.text === "string") {
      out += node.text;
    } else if (Array.isArray(node.content)) {
      out += inlineToText(node.content);
    } else if (typeof node.content === "string") {
      out += node.content;
    } else if (node.props && typeof node.props.label === "string") {
      // Custom inline (e.g. @mention) — surface its label so it is searchable.
      out += node.props.label;
    }
  }
  return out;
}

/**
 * Extract the visible plaintext of a single block (excluding its children).
 * Custom blocks expose their meaningful text via well-known props:
 *   - Mermaid / Code blocks → `props.code`
 *   - Callout → falls through to inline content
 */
export function blockText(block: BlockNoteBlock): string {
  const props = block.props ?? {};
  if (typeof props.code === "string" && props.code.length > 0) {
    return props.code;
  }
  if (Array.isArray(block.content)) {
    return inlineToText(block.content as InlineContentNode[]);
  }
  return "";
}

/**
 * Flatten an entire BlockNote document to plaintext. Used to derive
 * `Document.contentText`, which feeds the tsvector trigger and (M3) embeddings.
 * Blocks are separated by newlines; nested children are included depth-first so
 * the text reads in document order.
 */
export function blocknoteToPlainText(doc: unknown): string {
  if (!Array.isArray(doc)) return "";
  const lines: string[] = [];
  const walk = (blocks: BlockNoteBlock[]): void => {
    for (const block of blocks) {
      const text = blockText(block);
      if (text.trim().length > 0) lines.push(text);
      if (Array.isArray(block.children) && block.children.length > 0) {
        walk(block.children);
      }
    }
  };
  walk(doc as BlockNoteBlock[]);
  return lines.join("\n");
}

/** A flattened Block-table row derived from the editor document. */
export interface ProjectedBlock {
  /** Stable BlockNote block id — reused as the Block.id so projection is idempotent. */
  id: string;
  parentId: string | null;
  order: number;
  type: string;
  json: BlockNoteBlock;
  text: string;
}

/**
 * Project a BlockNote document into a flat list of Block rows mirroring the
 * editor tree. `order` is the sibling index (BlockNote already maintains order;
 * we record it as a Float for the schema's fractional-index column). The block's
 * own `id` is preserved so re-saves upsert in place rather than churn rows.
 *
 * Children are emitted with their `parentId` set; the returned list is in
 * document (depth-first) order.
 */
export function projectBlocks(doc: unknown): ProjectedBlock[] {
  if (!Array.isArray(doc)) return [];
  const rows: ProjectedBlock[] = [];
  let fallback = 0;
  const walk = (blocks: BlockNoteBlock[], parentId: string | null): void => {
    blocks.forEach((block, index) => {
      const id = typeof block.id === "string" && block.id ? block.id : `b${fallback++}`;
      rows.push({
        id,
        parentId,
        order: index,
        type: typeof block.type === "string" ? block.type : "paragraph",
        json: block,
        text: blockText(block),
      });
      if (Array.isArray(block.children) && block.children.length > 0) {
        walk(block.children, id);
      }
    });
  };
  walk(doc as BlockNoteBlock[], null);
  return rows;
}
