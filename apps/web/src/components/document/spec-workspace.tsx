"use client";

import * as React from "react";

import type { Scope } from "@forgespecs/core";
import { useSession } from "@/lib/auth/client";
import { SpecEditor } from "@/components/document/spec-editor";
import { CollaborationPanel } from "@/features/collaboration/collaboration-panel";
import type { CollaborationCapabilities } from "@/features/collaboration/collaboration-panel";
import {
  EditorBridgeProvider,
  type EditorBridgeValue,
} from "@/features/editor/editor-bridge";
import type { MentionTarget } from "@/features/editor/ForgeEditor";
import { useUiStore } from "@/lib/store/ui";
import { SelectionToolbar } from "@/features/ai/selection-toolbar";
import { DocumentExportButton } from "@/features/agents/document-export-button";

function slugifyFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document"
  );
}

/**
 * The editor + collaboration surface for a spec. Owns the editor bridge so the
 * comment sidebar (anchors against the live Y.Doc) and the suggestion accept
 * flow (apply through the editor → Yjs) share the same editor instance, while
 * keeping BlockNote quarantined behind the bridge interface.
 */
export function SpecWorkspace({
  documentId,
  docTitle,
  initialContent,
  editable,
  mentionTargets,
  scope,
  link,
  caps,
}: {
  documentId: string;
  docTitle: string;
  initialContent: unknown;
  editable: boolean;
  mentionTargets: MentionTarget[];
  scope: Scope;
  link: string;
  caps: CollaborationCapabilities;
}) {
  const { data: session } = useSession();
  const [bridge, setBridge] = React.useState<EditorBridgeValue | null>(null);
  const setAiContext = useUiStore((s) => s.setAiContext);

  const ctx = React.useMemo(
    () => ({ documentId, scope, docTitle, link }),
    [documentId, scope, docTitle, link],
  );

  const onBridge = React.useCallback((b: EditorBridgeValue) => setBridge(b), []);

  // Publish this doc + scope to the AI context store so the (parallel-route) AI
  // panel auto-loads context against the document the user is viewing. Cleared
  // on unmount so a navigated-away doc doesn't linger in the panel's body.
  React.useEffect(() => {
    setAiContext({
      documentId,
      workspaceId: scope.workspaceId,
      projectId: scope.kind === "project" ? scope.projectId : null,
    });
    return () => setAiContext({ documentId: null, selectionText: null });
  }, [documentId, scope, setAiContext]);

  return (
    <EditorBridgeProvider value={bridge ?? FALLBACK_BRIDGE}>
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-3xl p-6">
            <div className="mb-2 flex justify-end">
              <DocumentExportButton
                documentId={documentId}
                baseFilename={slugifyFilename(docTitle)}
              />
            </div>
            {editable ? (
              <SelectionToolbar documentId={documentId} scope={scope} />
            ) : null}
            <SpecEditor
              documentId={documentId}
              initialContent={initialContent}
              editable={editable}
              mentionTargets={mentionTargets}
              onBridge={onBridge}
            />
          </div>
        </div>
        <CollaborationPanel
          ctx={ctx}
          mentionTargets={mentionTargets}
          caps={caps}
          currentUserId={session?.user?.id ?? null}
        />
      </div>
    </EditorBridgeProvider>
  );
}

/** No-op bridge used until the editor publishes a real one (read-only / loading). */
const FALLBACK_BRIDGE: EditorBridgeValue = {
  doc: null,
  getSelection: () => null,
  getDocumentJSON: () => [],
  applyDocumentJSON: () => {},
  focusBlock: () => {},
};
