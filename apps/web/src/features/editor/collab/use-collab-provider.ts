"use client";

import * as React from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import { BLOCKNOTE_FRAGMENT } from "@forgespecs/core";

/**
 * Resolve the collab websocket base URL. The browser connects directly to the
 * standalone collab process. Configurable via NEXT_PUBLIC_COLLAB_URL; defaults to
 * the dev port. y-websocket appends the room name (the documentId) to this base.
 */
function collabBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_COLLAB_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:1234`;
  }
  return "ws://localhost:1234";
}

export type CollabConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "offline";

export interface CollabHandle {
  /** The shared Y.XmlFragment BlockNote binds its content to. */
  fragment: Y.XmlFragment;
  /** Awareness provider passed to BlockNote for cursors/presence. */
  provider: WebsocketProvider;
  doc: Y.Doc;
  status: CollabConnectionStatus;
}

/**
 * Create (and tear down) a Yjs document + y-websocket provider for a document.
 *
 * SINGLE-PLAYER FALLBACK: the provider auto-reconnects; if the collab server is
 * unreachable the status reports "offline"/"disconnected" but the editor still
 * works against the local Y.Doc (BlockNote treats it as a normal collaborative
 * doc with one participant). When the server returns, the WebsocketProvider
 * resyncs automatically and edits made offline converge.
 *
 * The collab server owns persistence (compaction → contentJSON/Block), so there
 * is no REST save on the hot edit path anymore. The explicit version-snapshot
 * path (M8) is unaffected — it reads the server-projected contentJSON.
 *
 * Returns null until mounted on the client (this hook is only used inside an
 * ssr:false editor, but the null guard keeps it safe).
 */
export function useCollabProvider(
  documentId: string,
  user: { name: string; color: string },
): CollabHandle | null {
  const [handle, setHandle] = React.useState<CollabHandle | null>(null);

  // Keep the latest user info without forcing provider re-creation on changes.
  const userRef = React.useRef(user);
  userRef.current = user;

  React.useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(collabBaseUrl(), documentId, doc, {
      // Connect lazily so we can attach listeners first.
      connect: false,
    });

    // Seed our presence (name + cursor color) for peers' cursor labels.
    provider.awareness.setLocalStateField("user", userRef.current);

    const fragment = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);

    const updateStatus = (status: CollabConnectionStatus): void => {
      setHandle((prev) => (prev ? { ...prev, status } : prev));
    };

    const onStatus = (e: { status: "connecting" | "connected" | "disconnected" }) => {
      updateStatus(e.status);
    };
    const onConnectionError = () => updateStatus("offline");

    provider.on("status", onStatus);
    provider.on("connection-error", onConnectionError);
    provider.on("connection-close", () => updateStatus("disconnected"));

    setHandle({ fragment, provider, doc, status: "connecting" });
    provider.connect();

    return () => {
      provider.off("status", onStatus);
      provider.off("connection-error", onConnectionError);
      // Disconnect + destroy releases the socket and the doc.
      provider.disconnect();
      provider.destroy();
      doc.destroy();
      setHandle(null);
    };
    // Re-create only when the room changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Reflect live user info into awareness without re-creating the provider.
  React.useEffect(() => {
    handle?.provider.awareness.setLocalStateField("user", user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, user.name, user.color]);

  return handle;
}

/** Deterministic, pleasant cursor color from a user id. */
export function colorForUser(id: string): string {
  const palette = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length]!;
}
