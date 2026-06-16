import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  BLOCKNOTE_FRAGMENT,
  yDocToBlockNote,
  yXmlFragmentToBlockNote,
} from "./yjs-projection";
import { blocknoteToPlainText, projectBlocks } from "./block-content";

/**
 * Build a BlockNote-shaped `blockContainer` Y.XmlElement.
 *
 * Mirrors the y-prosemirror representation BlockNote writes:
 *   <blockContainer id=…>
 *     <{type} …props>…text…</{type}>
 *     [<blockGroup>…children…</blockGroup>]
 *   </blockContainer>
 */
function makeBlock(opts: {
  id: string;
  type: string;
  text?: string;
  props?: Record<string, string>;
  contentProps?: Record<string, string>;
  children?: Y.XmlElement[];
}): Y.XmlElement {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", opts.id);
  for (const [k, v] of Object.entries(opts.props ?? {})) {
    container.setAttribute(k, v);
  }

  const content = new Y.XmlElement(opts.type);
  for (const [k, v] of Object.entries(opts.contentProps ?? {})) {
    content.setAttribute(k, v);
  }
  if (opts.text) {
    const t = new Y.XmlText();
    t.insert(0, opts.text);
    content.insert(0, [t]);
  }
  container.insert(0, [content]);

  if (opts.children && opts.children.length > 0) {
    const group = new Y.XmlElement("blockGroup");
    group.insert(0, opts.children);
    container.insert(container.length, [group]);
  }

  return container;
}

function seedDoc(blocks: Y.XmlElement[]): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
  frag.insert(0, blocks);
  return doc;
}

describe("yjs-projection: Y.XmlFragment → BlockNote JSON", () => {
  it("projects a flat list of blocks with ids, types and text", () => {
    const doc = seedDoc([
      makeBlock({ id: "b1", type: "heading", text: "Title", contentProps: { level: "1" } }),
      makeBlock({ id: "b2", type: "paragraph", text: "Hello world" }),
    ]);

    const blocks = yDocToBlockNote(doc);
    expect(blocks).toHaveLength(2);

    expect(blocks[0]).toMatchObject({ id: "b1", type: "heading" });
    expect(blocks[0]?.props).toMatchObject({ level: "1" });
    expect(blocks[1]).toMatchObject({ id: "b2", type: "paragraph" });

    // Inline text is captured.
    expect(blocknoteToPlainText(blocks)).toBe("Title\nHello world");
  });

  it("preserves nested children (blockGroup) depth-first", () => {
    const child = makeBlock({ id: "c1", type: "paragraph", text: "child" });
    const doc = seedDoc([
      makeBlock({
        id: "p1",
        type: "bulletListItem",
        text: "parent",
        children: [child],
      }),
    ]);

    const blocks = yXmlFragmentToBlockNote(doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.children).toHaveLength(1);
    expect(blocks[0]?.children?.[0]).toMatchObject({ id: "c1", type: "paragraph" });

    // Depth-first plaintext (parent then child).
    expect(blocknoteToPlainText(blocks)).toBe("parent\nchild");
  });

  it("feeds projectBlocks to produce a flat, parent-linked Block tree", () => {
    const child = makeBlock({ id: "c1", type: "paragraph", text: "child" });
    const doc = seedDoc([
      makeBlock({ id: "p1", type: "paragraph", text: "parent", children: [child] }),
      makeBlock({ id: "p2", type: "paragraph", text: "sibling" }),
    ]);

    const rows = projectBlocks(yDocToBlockNote(doc));
    // p1, c1 (child of p1), p2 — document order, depth-first.
    expect(rows.map((r) => r.id)).toEqual(["p1", "c1", "p2"]);
    expect(rows.find((r) => r.id === "c1")?.parentId).toBe("p1");
    expect(rows.find((r) => r.id === "p1")?.parentId).toBeNull();
    expect(rows.find((r) => r.id === "p2")?.order).toBe(1);
  });

  it("captures custom block payloads via content-node props (Code/Mermaid)", () => {
    const doc = seedDoc([
      makeBlock({
        id: "code1",
        type: "codeBlock",
        contentProps: { language: "ts", code: "const x = 1;" },
      }),
    ]);

    const blocks = yDocToBlockNote(doc);
    expect(blocks[0]?.props).toMatchObject({ language: "ts", code: "const x = 1;" });
    // blockText prefers props.code → plaintext is the code (searchable).
    expect(blocknoteToPlainText(blocks)).toBe("const x = 1;");
  });

  it("surfaces custom inline content (mentions) as searchable labels", () => {
    const container = new Y.XmlElement("blockContainer");
    container.setAttribute("id", "m1");
    const content = new Y.XmlElement("paragraph");
    const before = new Y.XmlText();
    before.insert(0, "hey ");
    const mention = new Y.XmlElement("mention");
    mention.setAttribute("label", "@Alice");
    mention.setAttribute("id", "user_1");
    content.insert(0, [before]);
    content.insert(content.length, [mention]);
    container.insert(0, [content]);

    const blocks = yXmlFragmentToBlockNote(seedDoc([container]).getXmlFragment(BLOCKNOTE_FRAGMENT));
    const inline = blocks[0]?.content;
    expect(Array.isArray(inline)).toBe(true);
    // text run + mention element projected.
    expect(blocknoteToPlainText(blocks)).toContain("hey ");
    expect(blocknoteToPlainText(blocks)).toContain("@Alice");
  });

  it("round-trips through an applied update (encode → new doc → project)", () => {
    // Simulates the persistence path: build a doc, encode it as an update, apply
    // to a fresh doc (as the compaction loader does), then project.
    const source = seedDoc([
      makeBlock({ id: "x1", type: "paragraph", text: "persisted" }),
    ]);
    const update = Y.encodeStateAsUpdate(source);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, update);

    const blocks = yDocToBlockNote(restored);
    expect(blocks).toHaveLength(1);
    expect(blocknoteToPlainText(blocks)).toBe("persisted");
  });

  it("returns an empty projection for an empty document", () => {
    expect(yDocToBlockNote(new Y.Doc())).toEqual([]);
  });
});
