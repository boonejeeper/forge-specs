/**
 * Pure projection from a Yjs collaborative document (the editor's CRDT body) to
 * BlockNote-style JSON — WITHOUT instantiating BlockNote or ProseMirror.
 *
 * BlockNote stores its content in a `Y.XmlFragment` (default name `"prosemirror"`)
 * using the standard y-prosemirror representation of BlockNote's schema:
 *
 *   <blockGroup>                         (implicit at the fragment root)
 *     <blockContainer id=… …attrs>       one per top-level block
 *       <paragraph|heading|codeBlock|…>  the "blockContent" node → block.type
 *         …inline content / text…
 *       </…>
 *       <blockGroup>                      (only when the block has children)
 *         <blockContainer …>…</…>
 *       </blockGroup>
 *     </blockContainer>
 *   </blockGroup>
 *
 * We walk that tree with plain Yjs types (`Y.XmlElement` / `Y.XmlText`) and emit
 * the same `{ id, type, props, content, children }` shape the web Server Action
 * already projects from in M2. Reusing it means `projectBlocks` /
 * `blocknoteToPlainText` (and therefore the Block table, contentText, tsvector
 * and embeddings) are identical whether content arrives via the M2 REST save or
 * the M4 collab compaction.
 *
 * This module is deliberately dependency-light: it only needs `yjs` (already a
 * transitive dep via BlockNote, and a direct dep here) and runs in plain Node,
 * so it is fully unit-testable by constructing a Y.Doc in memory.
 */
import * as Y from "yjs";

import type { BlockNoteBlock, InlineContentNode } from "./block-content";

/** Default Y.XmlFragment name BlockNote / y-prosemirror collaborate on. */
export const BLOCKNOTE_FRAGMENT = "prosemirror" as const;

/** Container node name wrapping every block in the BlockNote PM schema. */
const BLOCK_CONTAINER = "blockContainer";
/** Group node name wrapping a list of block containers (root + children). */
const BLOCK_GROUP = "blockGroup";

type XmlNode = Y.XmlElement | Y.XmlText | Y.XmlHook;

function isElement(node: XmlNode): node is Y.XmlElement {
  return node instanceof Y.XmlElement;
}

function isText(node: XmlNode): node is Y.XmlText {
  return node instanceof Y.XmlText;
}

/**
 * Convert a y-prosemirror inline node (a `Y.XmlText` carrying ProseMirror marks,
 * or a custom inline `Y.XmlElement` like a mention) into BlockNote inline JSON.
 */
function inlineFromXml(node: XmlNode): InlineContentNode[] {
  if (isText(node)) {
    // Y.XmlText delta → BlockNote text nodes (one per formatting run). We drop
    // marks for projection purposes (text + searchability is what matters); the
    // canonical styled content lives in contentJSON's structure already.
    const delta = node.toDelta() as Array<{
      insert?: unknown;
      attributes?: Record<string, unknown>;
    }>;
    const out: InlineContentNode[] = [];
    for (const op of delta) {
      if (typeof op.insert === "string") {
        out.push({ type: "text", text: op.insert });
      }
    }
    return out;
  }

  if (isElement(node)) {
    // Custom inline content (e.g. a mention) is a leaf XmlElement whose attrs
    // carry the payload. Surface its label so it remains searchable.
    const attrs = node.getAttributes() as Record<string, unknown>;
    return [
      {
        type: node.nodeName,
        props: attrs,
      },
    ];
  }

  return [];
}

/** Collect inline content from a blockContent node's children. */
function inlineContentOf(contentNode: Y.XmlElement): InlineContentNode[] {
  const out: InlineContentNode[] = [];
  contentNode.toArray().forEach((child) => {
    out.push(...inlineFromXml(child as XmlNode));
  });
  return out;
}

/**
 * Project a single `blockContainer` element into a BlockNote block (recursing
 * into its child blockGroup). Returns null for malformed containers.
 */
function blockFromContainer(container: Y.XmlElement): BlockNoteBlock | null {
  const children = container.toArray() as XmlNode[];

  // First element child is the "blockContent" node (paragraph/heading/custom);
  // an optional trailing blockGroup holds nested child blocks.
  let contentNode: Y.XmlElement | undefined;
  let childGroup: Y.XmlElement | undefined;
  for (const child of children) {
    if (!isElement(child)) continue;
    if (child.nodeName === BLOCK_GROUP) {
      childGroup = child;
    } else if (!contentNode) {
      contentNode = child;
    }
  }

  const containerAttrs =
    (container.getAttributes() as Record<string, unknown>) ?? {};
  const id =
    typeof containerAttrs.id === "string" && containerAttrs.id
      ? containerAttrs.id
      : undefined;

  if (!contentNode) {
    // Container with no content node — still emit a paragraph so ids/order hold.
    return {
      id,
      type: "paragraph",
      props: stripContainerOnlyAttrs(containerAttrs),
      content: [],
    };
  }

  const type = contentNode.nodeName;
  // Props live partly on the container (e.g. backgroundColor/textColor) and
  // partly on the content node (e.g. level, language, code). Merge, content wins.
  const props: Record<string, unknown> = {
    ...stripContainerOnlyAttrs(containerAttrs),
    ...((contentNode.getAttributes() as Record<string, unknown>) ?? {}),
  };

  const block: BlockNoteBlock = {
    id,
    type,
    props,
    content: inlineContentOf(contentNode),
  };

  if (childGroup) {
    const childBlocks = blocksFromGroup(childGroup);
    if (childBlocks.length > 0) block.children = childBlocks;
  }

  return block;
}

/** The container `id` is hoisted onto the block; don't duplicate it into props. */
function stripContainerOnlyAttrs(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const { id: _id, ...rest } = attrs;
  return rest;
}

/** Project all blockContainers directly under a blockGroup. */
function blocksFromGroup(group: Y.XmlElement): BlockNoteBlock[] {
  const out: BlockNoteBlock[] = [];
  group.toArray().forEach((child) => {
    if (isElement(child as XmlNode) && (child as Y.XmlElement).nodeName === BLOCK_CONTAINER) {
      const block = blockFromContainer(child as Y.XmlElement);
      if (block) out.push(block);
    }
  });
  return out;
}

/**
 * Project a BlockNote `Y.XmlFragment` into BlockNote-style document JSON.
 *
 * The fragment's direct children are the top-level `blockContainer`s (the root
 * acts as the outermost blockGroup). Unknown/stray nodes are skipped defensively.
 */
export function yXmlFragmentToBlockNote(fragment: Y.XmlFragment): BlockNoteBlock[] {
  const out: BlockNoteBlock[] = [];
  fragment.toArray().forEach((child) => {
    const node = child as XmlNode;
    if (!isElement(node)) return;
    if (node.nodeName === BLOCK_CONTAINER) {
      const block = blockFromContainer(node);
      if (block) out.push(block);
    } else if (node.nodeName === BLOCK_GROUP) {
      // Some encoders wrap top-level blocks in an explicit blockGroup.
      out.push(...blocksFromGroup(node));
    }
  });
  return out;
}

/**
 * Project a whole `Y.Doc` (the collab room document) into BlockNote JSON, using
 * BlockNote's default fragment name. This is the entry point the collab
 * compaction path calls before handing the result to `projectBlocks` /
 * `blocknoteToPlainText`.
 */
export function yDocToBlockNote(
  doc: Y.Doc,
  fragmentName: string = BLOCKNOTE_FRAGMENT,
): BlockNoteBlock[] {
  return yXmlFragmentToBlockNote(doc.getXmlFragment(fragmentName));
}
