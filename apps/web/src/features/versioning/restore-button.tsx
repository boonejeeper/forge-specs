"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import type { Scope } from "@forgespecs/core";

import { Button } from "@/components/ui/button";
import { restoreVersion } from "@/lib/actions/versions";
import { queryKeys } from "@/lib/query/keys";

/**
 * Restore button (M8) — fork-forward, never destructive. Guarded by `canRestore`
 * (doc.edit) at render AND by the Server Action's `withPermission`.
 *
 * The action creates a NEW version equal to the target snapshot and writes the
 * content onto the live document projection server-side. We then navigate back
 * to the document: if a collab room is live, the editor resyncs from the updated
 * projection on (re)load; for an actively-open editor the same restore is also
 * available from the doc view, where it applies through BlockNote → Yjs (the
 * accept-suggestion convergence path). History is preserved either way.
 */
export function RestoreButton({
  documentId,
  versionNum,
  scope,
  base,
  canRestore,
}: {
  documentId: string;
  versionNum: number;
  scope: Scope;
  /** Spec base path to return to after restore. */
  base: string;
  canRestore: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);

  if (!canRestore) return null;

  async function restore(): Promise<void> {
    setPending(true);
    try {
      const res = await restoreVersion({ documentId, versionNum, scope });
      qc.invalidateQueries({ queryKey: queryKeys.documents.versions(documentId) });
      qc.invalidateQueries({ queryKey: queryKeys.documents.detail(documentId) });
      // Stash the restored body so the editor can apply it through Yjs on return
      // (live-room convergence) — read + cleared by the editor mount.
      try {
        sessionStorage.setItem(
          `forgespecs:restore:${documentId}`,
          JSON.stringify({ versionNum: res.versionNum, content: res.content }),
        );
      } catch {
        /* sessionStorage unavailable — projection update still applied */
      }
      router.push(base);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() => void restore()}
    >
      <History className="size-4" />
      {pending ? "Restoring…" : `Restore v${versionNum}`}
    </Button>
  );
}
