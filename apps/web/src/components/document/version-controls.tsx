"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { History, Tag } from "lucide-react";
import type { Scope } from "@forgespecs/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace, useProject } from "@/lib/context/workspace-context";
import { snapshotDocumentVersion } from "@/lib/actions/documents";
import { queryKeys } from "@/lib/query/keys";

/**
 * Version controls for the doc view (M8): a link into the version history
 * sub-route, a quick "Snapshot" (auto/AI-summarized), and a "Name a snapshot"
 * dialog for an explicit labelled checkpoint. Editable-only (doc.edit); the
 * Server Action enforces the same permission.
 */
export function VersionControls({
  documentId,
  historyHref,
}: {
  documentId: string;
  historyHref: string;
}) {
  const { workspaceId } = useWorkspace();
  const { projectId } = useProject();
  const qc = useQueryClient();
  const scope: Scope = { kind: "project", workspaceId, projectId };

  const [pending, setPending] = React.useState(false);
  const [namedOpen, setNamedOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: queryKeys.documents.versions(documentId) });
    qc.invalidateQueries({ queryKey: queryKeys.documents.detail(documentId) });
  };

  async function quickSnapshot(): Promise<void> {
    setPending(true);
    try {
      await snapshotDocumentVersion({ documentId, scope });
      invalidate();
    } finally {
      setPending(false);
    }
  }

  async function namedSnapshot(): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      await snapshotDocumentVersion({ documentId, label: trimmed, scope });
      invalidate();
      setLabel("");
      setNamedOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" asChild>
        <Link href={historyHref}>
          <History className="size-4" />
          History
        </Link>
      </Button>

      <Dialog open={namedOpen} onOpenChange={setNamedOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending}>
            <Tag className="size-4" />
            Name a snapshot
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a named snapshot</DialogTitle>
            <DialogDescription>
              Checkpoint the current document with a label you choose. Named
              snapshots are always created, even without changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="snapshot-label">Label</Label>
            <Input
              id="snapshot-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Ready for review"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void namedSnapshot();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNamedOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || !label.trim()}
              onClick={() => void namedSnapshot()}
            >
              {pending ? "Saving…" : "Create snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button variant="outline" size="sm" onClick={quickSnapshot} disabled={pending}>
        <History className="size-4" />
        {pending ? "Snapshotting…" : "Snapshot version"}
      </Button>
    </div>
  );
}
