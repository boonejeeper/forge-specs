"use client";

import * as React from "react";

import {
  useOptionalProject,
  useOptionalWorkspace,
} from "@/lib/context/workspace-context";
import { useUiStore } from "@/lib/store/ui";

/**
 * Pushes the current workspace + project ids into `useUiStore.aiContext` so the
 * globally-mounted chat panel knows the user's scope on every route — including
 * routes that don't open a document (workspace landing, activity, inbox, etc.).
 *
 * SpecWorkspace continues to own `documentId` (it has the live editor); this
 * component only touches workspaceId and projectId so the two don't fight.
 */
export function AiContextSync() {
  const workspace = useOptionalWorkspace();
  const project = useOptionalProject();
  const setAiContext = useUiStore((s) => s.setAiContext);

  React.useEffect(() => {
    setAiContext({
      workspaceId: workspace?.workspaceId ?? null,
      projectId: project?.projectId ?? null,
    });
  }, [workspace?.workspaceId, project?.projectId, setAiContext]);

  return null;
}
