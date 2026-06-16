"use client";

import * as React from "react";
import { DocumentStatus } from "@forgespecs/db";
import { nextStatuses } from "@forgespecs/core";
import type { Scope } from "@forgespecs/core";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, STATUS_LABEL } from "@/components/document/status-badge";
import { useWorkspace, useProject } from "@/lib/context/workspace-context";
import { useChangeDocumentStatus } from "@/lib/query/use-documents";
import { updateFrontmatter } from "@/lib/actions/documents";
import type { Frontmatter } from "@/lib/data/documents";

/**
 * Editable metadata header on the spec placeholder page. Persists
 * owner/version/implementation_state via the `updateFrontmatter` server action;
 * status moves through the state machine via `changeDocumentStatus`.
 *
 * This is the agent-readiness frontmatter the doc's body editor (M2) will sit
 * beneath. Status is rendered here as the authoritative control.
 */
export function FrontmatterEditor({
  documentId,
  status,
  frontmatter,
  editable = true,
}: {
  documentId: string;
  status: DocumentStatus;
  frontmatter: Frontmatter;
  editable?: boolean;
}) {
  const { workspaceId } = useWorkspace();
  const { projectId } = useProject();
  const scope: Scope = { kind: "project", workspaceId, projectId };

  const changeStatus = useChangeDocumentStatus({ workspaceId, projectId });

  const [owner, setOwner] = React.useState(frontmatter.owner ?? "");
  const [version, setVersion] = React.useState(frontmatter.version ?? "");
  const [implState, setImplState] = React.useState(
    frontmatter.implementation_state ?? "",
  );
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await updateFrontmatter({
        documentId,
        scope,
        frontmatter: {
          owner: owner.trim(),
          version: version.trim(),
          implementation_state: implState.trim(),
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const transitions = nextStatuses(status);

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Status</Label>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!editable || transitions.length === 0}
                >
                  Change
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {transitions.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onSelect={() =>
                      changeStatus.mutate({ documentId, status: s })
                    }
                  >
                    {STATUS_LABEL[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="fm-owner">Owner</Label>
          <Input
            id="fm-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="e.g. platform-team"
            disabled={!editable}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fm-version">Version</Label>
          <Input
            id="fm-version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="e.g. 1.0.0"
            disabled={!editable}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fm-impl">Implementation state</Label>
          <Input
            id="fm-impl"
            value={implState}
            onChange={(e) => setImplState(e.target.value)}
            placeholder="e.g. not_started"
            disabled={!editable}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!editable || saving}>
          {saving ? "Saving…" : "Save metadata"}
        </Button>
        {saved ? (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" />
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
