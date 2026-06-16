"use client";

import * as React from "react";
import type * as Y from "yjs";

/**
 * Editor bridge — the seam between the quarantined BlockNote editor and the M5
 * collaboration surfaces (comments / suggestions) that live OUTSIDE the editor
 * (the sidebar panel, the selection toolbar).
 *
 * It exposes only what those surfaces need, never BlockNote internals:
 *  - the live `Y.Doc` (to resolve comment anchors → absolute positions),
 *  - the current selection (block id + char offsets) for anchoring new comments
 *    and seeding new suggestions,
 *  - imperative ops the panel triggers (apply an accepted suggestion's body,
 *    scroll/select an anchored range).
 *
 * Keeping this a small, stable interface honours the editor-quarantine rule: the
 * panel depends on the bridge, not on `@blocknote/*`.
 */

export interface EditorSelection {
  blockId: string | null;
  /** Char offsets within the block's text (collapsed → start === end). */
  start: number;
  end: number;
  /** The selected text (for suggestion seeding / preview). */
  text: string;
}

export interface EditorBridgeValue {
  /** The live collaborative document, or null in read-only/no-collab mode. */
  doc: Y.Doc | null;
  /** Read the current selection (block + offsets). */
  getSelection: () => EditorSelection | null;
  /** Current full document body as BlockNote JSON (for suggestion diffing). */
  getDocumentJSON: () => unknown;
  /** Replace the whole body (used to apply an accepted suggestion via Yjs). */
  applyDocumentJSON: (next: unknown) => void;
  /** Focus + select an anchored range so the user sees what a thread points at. */
  focusBlock: (blockId: string) => void;
}

const EditorBridgeContext = React.createContext<EditorBridgeValue | null>(null);

export function EditorBridgeProvider({
  value,
  children,
}: {
  value: EditorBridgeValue;
  children: React.ReactNode;
}) {
  return (
    <EditorBridgeContext.Provider value={value}>
      {children}
    </EditorBridgeContext.Provider>
  );
}

/** Access the editor bridge. Returns null when used outside an editable editor. */
export function useEditorBridge(): EditorBridgeValue | null {
  return React.useContext(EditorBridgeContext);
}
