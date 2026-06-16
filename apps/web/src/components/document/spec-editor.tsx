"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Cloud, CloudOff, Loader2, Lock } from "lucide-react";
import type { Scope } from "@forgespecs/core";

import { useWorkspace, useProject } from "@/lib/context/workspace-context";
import { useSession } from "@/lib/auth/client";
import { saveDocumentContent } from "@/lib/actions/documents";
import type { MentionTarget } from "@/features/editor/ForgeEditor";
import type { EditorBridgeValue } from "@/features/editor/editor-bridge";
import {
  useCollabProvider,
  colorForUser,
  type CollabConnectionStatus,
} from "@/features/editor/collab/use-collab-provider";

/**
 * BlockNote is client-only (touches `document`/`window` at import). It must be
 * dynamically imported with ssr:false so Next never tries to render it on the
 * server. Mermaid/Shiki/CodeMirror live inside custom blocks and are themselves
 * lazy — none of that weight loads until the editor mounts.
 */
const ForgeEditor = dynamic(() => import("@/features/editor/ForgeEditor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

function EditorSkeleton() {
  return (
    <div className="space-y-3 py-2" aria-hidden>
      <div className="h-7 w-2/5 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}

export function SpecEditor({
  documentId,
  initialContent,
  editable,
  mentionTargets,
  onBridge,
}: {
  documentId: string;
  initialContent: unknown;
  editable: boolean;
  mentionTargets: MentionTarget[];
  onBridge?: (bridge: EditorBridgeValue) => void;
}) {
  // Read-only viewers don't open a collab connection (the handshake requires
  // doc.edit anyway). They render the projected contentJSON statically.
  if (!editable) {
    return (
      <div className="space-y-2">
        <div className="flex h-5 items-center justify-end">
          <ReadOnlyIndicator />
        </div>
        <div className="-mx-3">
          <ForgeEditor
            documentId={documentId}
            initialContent={initialContent}
            editable={false}
            mentionTargets={mentionTargets}
            onBridge={onBridge}
          />
        </div>
      </div>
    );
  }

  return (
    <CollaborativeEditor
      documentId={documentId}
      initialContent={initialContent}
      mentionTargets={mentionTargets}
      onBridge={onBridge}
    />
  );
}

/**
 * Editable editor. Opens a Yjs collab provider; Yjs is the live source of truth
 * and the collab server owns persistence. If the collab server is unreachable
 * the provider stays in single-player fallback (local Y.Doc) and resyncs on
 * reconnect.
 */
function CollaborativeEditor({
  documentId,
  initialContent,
  mentionTargets,
  onBridge,
}: {
  documentId: string;
  initialContent: unknown;
  mentionTargets: MentionTarget[];
  onBridge?: (bridge: EditorBridgeValue) => void;
}) {
  const { data: session } = useSession();

  const user = React.useMemo(
    () => ({
      name: session?.user?.name ?? "Anonymous",
      color: colorForUser(session?.user?.id ?? "anon"),
    }),
    [session?.user?.name, session?.user?.id],
  );

  const collab = useCollabProvider(documentId, user);

  // While the provider initializes, show the skeleton (it resolves on the next
  // tick after mount). Mounting ForgeEditor only once `collab` exists guarantees
  // BlockNote binds to the shared fragment at creation time.
  if (!collab) {
    return (
      <div className="space-y-2">
        <div className="flex h-5 items-center justify-end" />
        <div className="-mx-3">
          <EditorSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-5 items-center justify-end">
        <ConnectionIndicator status={collab.status} />
      </div>
      <div className="-mx-3">
        <ForgeEditor
          documentId={documentId}
          // Ignored in collab mode (Yjs owns content) but kept for the seam.
          initialContent={initialContent}
          editable
          mentionTargets={mentionTargets}
          onBridge={onBridge}
          collab={{
            fragment: collab.fragment,
            awareness: collab.provider.awareness,
            user,
          }}
        />
      </div>
    </div>
  );
}

function ReadOnlyIndicator() {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="size-3.5" />
      Read-only
    </span>
  );
}

function ConnectionIndicator({ status }: { status: CollabConnectionStatus }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <Cloud className="size-3.5" />
        Live
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Connecting…
      </span>
    );
  }
  // disconnected / offline → single-player fallback (edits persist locally and
  // resync on reconnect).
  return (
    <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
      <CloudOff className="size-3.5" />
      Offline — editing locally
    </span>
  );
}

// ── Single-player REST fallback (retained for environments without a collab
// server, e.g. unit/integration contexts). Not used on the live editable path
// above, but kept so the M2 save seam remains intact and callable. ──────────

const SAVE_DEBOUNCE_MS = 800;
type SaveState = "idle" | "saving" | "saved" | "error";

export function useRestSave(documentId: string, scope: Scope) {
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<unknown>(null);

  const flush = React.useCallback(async () => {
    const content = pending.current;
    pending.current = null;
    setSaveState("saving");
    try {
      await saveDocumentContent({ documentId, contentJSON: content, scope });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [documentId, scope]);

  const onChange = React.useCallback(
    (_docId: string, content: unknown) => {
      pending.current = content;
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) void flush();
    };
  }, [flush]);

  return { onChange, saveState };
}
