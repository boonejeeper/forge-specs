"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { filterSuggestionItems } from "@blocknote/core";
import { Bot } from "lucide-react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { schema } from "./schema";
import { customSlashItems } from "./slash-menu";
import type { EditorBridgeValue, EditorSelection } from "./editor-bridge";

export interface MentionTarget {
  id: string;
  /** Display text, e.g. "Alice" — rendered as "@Alice". */
  label: string;
  kind: "user" | "agent";
}

/**
 * Realtime collaboration wiring (M4). When `collab` is provided the editor binds
 * to a shared `Y.XmlFragment` and surfaces cursors/presence via the provider's
 * awareness — Yjs becomes the live source of truth and the collab server owns
 * persistence (compaction → contentJSON/Block). When `collab` is absent the
 * editor falls back to single-player mode seeded from `initialContent` with the
 * caller's `onChange` doing REST persistence (the M2 path).
 */
export interface CollabConfig {
  fragment: Y.XmlFragment;
  awareness: Awareness;
  user: { name: string; color: string };
}

/**
 * Stable editor interface (the M2 seam). Callers (the doc page) stay identical;
 * realtime is opt-in via the `collab` prop, which plugs into BlockNote's native
 * `collaboration` option without changing the surrounding contract.
 */
export interface ForgeEditorProps {
  documentId: string;
  /** BlockNote document JSON, or null/empty for a fresh doc (single-player only). */
  initialContent: unknown;
  editable: boolean;
  /** Called (debounced upstream) with the full document JSON after edits. */
  onChange?: (documentId: string, content: unknown) => void;
  /** Project members for the @user mention menu. */
  mentionTargets?: MentionTarget[];
  /** Yjs collaboration binding. When set, realtime mode is active. */
  collab?: CollabConfig;
  /**
   * Receives a stable bridge the M5 collaboration surfaces (comment sidebar,
   * selection toolbar) use to read the selection / apply suggestions, without
   * importing BlockNote. Called once the editor is created.
   */
  onBridge?: (bridge: EditorBridgeValue) => void;
}

function normalizeInitial(content: unknown): unknown {
  if (Array.isArray(content) && content.length > 0) return content;
  return undefined;
}

export default function ForgeEditor({
  documentId,
  initialContent,
  editable,
  onChange,
  mentionTargets = [],
  collab,
  onBridge,
}: ForgeEditorProps) {
  const { resolvedTheme } = useTheme();

  // In collab mode the Y.XmlFragment is the source of truth — `initialContent`
  // must NOT also be applied (it would duplicate content). Single-player mode
  // seeds from initialContent as before.
  const editor = useCreateBlockNote(
    collab
      ? {
          schema,
          collaboration: {
            fragment: collab.fragment,
            user: collab.user,
            provider: { awareness: collab.awareness },
          },
        }
      : {
          schema,
          initialContent: normalizeInitial(initialContent) as never,
        },
    // Re-create the editor if the collab fragment identity changes (room switch).
    [collab?.fragment],
  );

  // Reflect the editable flag (RBAC) onto the live editor.
  React.useEffect(() => {
    editor.isEditable = editable;
  }, [editor, editable]);

  // One-time migration seed: a document authored under M2 has its body in
  // contentJSON but no Yjs state yet. When the FIRST client joins a fresh collab
  // room (empty fragment) and we have prior content, seed it once. A shared
  // Y.Map flag (`meta.seeded`) makes this idempotent across concurrent joiners:
  // only the client that wins the flag write performs the insert.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (!collab || !editable || seededRef.current) return;
    const initial = normalizeInitial(initialContent);
    if (!initial) return;

    const doc = collab.fragment.doc;
    if (!doc) return;

    const trySeed = (): void => {
      if (seededRef.current) return;
      // Empty fragment === brand-new collab doc.
      if (collab.fragment.length > 0) {
        seededRef.current = true;
        return;
      }
      const meta = doc.getMap<boolean>("meta");
      if (meta.get("seeded")) {
        seededRef.current = true;
        return;
      }
      seededRef.current = true;
      doc.transact(() => {
        meta.set("seeded", true);
        const top = editor.document;
        if (top.length > 0) {
          editor.replaceBlocks(top, initial as never);
        } else {
          editor.insertBlocks(initial as never, top[0] as never, "before");
        }
      });
    };

    // Defer briefly so the provider's initial sync (SyncStep2 from the server)
    // can populate the fragment first — we only seed a genuinely empty doc, never
    // on top of arriving remote state.
    const t = setTimeout(trySeed, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab, editable, editor]);

  // Build + publish the editor bridge for the M5 collaboration surfaces. We map
  // BlockNote's selection to { blockId, char offsets within the block } so the
  // core anchor helpers can bind a Yjs relative position to that block's text.
  React.useEffect(() => {
    if (!onBridge) return;

    const getSelection = (): EditorSelection | null => {
      try {
        const view = editor.prosemirrorView;
        const cursor = editor.getTextCursorPosition();
        const blockId = cursor?.block?.id ?? null;
        if (!view) {
          return blockId ? { blockId, start: 0, end: 0, text: "" } : null;
        }
        const { from, to } = view.state.selection;
        // Resolve offsets relative to the start of the textblock the selection
        // begins in (so they index into that block's prose, matching the anchor
        // helper's per-block coordinate space).
        const $from = view.state.doc.resolve(from);
        const textBlockStart = $from.start($from.depth);
        const start = Math.max(0, from - textBlockStart);
        const end = Math.max(start, to - textBlockStart);
        const text = view.state.doc.textBetween(from, to, "\n");
        return blockId ? { blockId, start, end, text } : null;
      } catch {
        return null;
      }
    };

    const bridge: EditorBridgeValue = {
      doc: collab?.fragment.doc ?? null,
      getSelection,
      getDocumentJSON: () => editor.document,
      applyDocumentJSON: (next: unknown) => {
        if (!Array.isArray(next)) return;
        const top = editor.document;
        if (top.length > 0) {
          editor.replaceBlocks(top, next as never);
        } else {
          editor.insertBlocks(next as never, top[0] as never, "before");
        }
      },
      focusBlock: (blockId: string) => {
        try {
          editor.setTextCursorPosition(blockId, "start");
          editor.focus();
        } catch {
          // Block may have been deleted; ignore.
        }
      },
    };
    onBridge(bridge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, onBridge, collab?.fragment]);

  // M8 restore convergence: when the user restored a version from the history
  // route, the body was stashed in sessionStorage. On returning to the doc we
  // apply it THROUGH the editor → Yjs (the same convergent path as
  // accept-suggestion), so a live collab room converges for everyone. The server
  // already updated the projection, so offline docs are also consistent. We
  // defer until after the initial collab sync to avoid racing remote state.
  React.useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    const key = `forgespecs:restore:${documentId}`;
    const apply = (): void => {
      if (cancelled) return;
      let raw: string | null = null;
      try {
        raw = sessionStorage.getItem(key);
      } catch {
        return;
      }
      if (!raw) return;
      try {
        sessionStorage.removeItem(key);
        const { content } = JSON.parse(raw) as { content: unknown };
        if (!Array.isArray(content)) return;
        const top = editor.document;
        if (top.length > 0) {
          editor.replaceBlocks(top, content as never);
        } else {
          editor.insertBlocks(content as never, top[0] as never, "before");
        }
      } catch {
        /* malformed stash — ignore */
      }
    };
    // Defer so collab SyncStep2 lands first; harmless in single-player mode.
    const t = setTimeout(apply, collab ? 600 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, documentId, editable, collab?.fragment]);

  const handleChange = React.useCallback(() => {
    // In collab mode Yjs owns sync + the server owns persistence, so onChange is
    // a no-op. In single-player mode it drives the REST debounce save.
    if (!editable || collab) return;
    onChange?.(documentId, editor.document);
  }, [editable, collab, onChange, documentId, editor]);

  // Slash menu = defaults + our custom spec blocks.
  const getSlashItems = React.useCallback(
    async (query: string) =>
      filterSuggestionItems(
        [...getDefaultReactSlashMenuItems(editor), ...customSlashItems(editor)],
        query,
      ),
    [editor],
  );

  // @-mention menu, resolved from project members (+ the @agent marker).
  const getMentionItems = React.useCallback(
    (query: string): DefaultReactSuggestionItem[] => {
      const agent: MentionTarget = {
        id: "agent",
        label: "agent",
        kind: "agent",
      };
      const targets = [...mentionTargets, agent];
      return filterSuggestionItems(
        targets.map((t) => ({
          title: t.label,
          aliases: [t.kind],
          icon: t.kind === "agent" ? <Bot className="size-4" /> : undefined,
          onItemClick: () => {
            editor.insertInlineContent([
              {
                type: "mention",
                props: { id: t.id, label: `@${t.label}`, kind: t.kind },
              },
              " ",
            ]);
          },
        })),
        query,
      ) as DefaultReactSuggestionItem[];
    },
    [editor, mentionTargets],
  );

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      slashMenu={false}
      onChange={handleChange}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={getSlashItems}
      />
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={async (query) => getMentionItems(query)}
      />
    </BlockNoteView>
  );
}
