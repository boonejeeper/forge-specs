"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { queryKeys } from "@/lib/query/keys";

/**
 * Agent execution mode menu — surfaced on a document. Generates tasks / epics /
 * repo-structure / agent-prompts FROM this doc into a new spec via the
 * /api/ai/agent-mode route (which goes through createDocument +
 * saveDocumentContent). On success, navigates to the new doc.
 */
const MODES = [
  { mode: "tasks", label: "Generate tasks" },
  { mode: "epics", label: "Generate epics" },
  { mode: "repo-structure", label: "Generate repo structure" },
  { mode: "agent-prompts", label: "Generate agent prompts" },
] as const;

export function AgentModeMenu({
  documentId,
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
}: {
  documentId: string;
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (mode: string): Promise<void> => {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/ai/agent-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          sourceDocumentId: documentId,
          workspaceId,
          projectId,
        }),
      });
      const data = (await res.json()) as {
        documentId?: string;
        message?: string;
        error?: string;
      };
      if (data.error === "ai_unavailable" || (!res.ok && !data.documentId)) {
        setError(data.message ?? data.error ?? "Generation failed.");
        return;
      }
      qc.invalidateQueries({ queryKey: queryKeys.documents.tree(projectId) });
      if (data.documentId) {
        router.push(
          `/${workspaceSlug}/${projectSlug}/specs/${data.documentId}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy !== null}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Bot className="size-4" />
            )}
            Agent mode
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {MODES.map((m) => (
            <DropdownMenuItem
              key={m.mode}
              disabled={busy !== null}
              onSelect={(e) => {
                e.preventDefault();
                void run(m.mode);
              }}
            >
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
