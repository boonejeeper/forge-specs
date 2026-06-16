"use client";

import * as React from "react";
import { Sparkles, Wand2, Check, X, Loader2 } from "lucide-react";
import type { Scope } from "@forgespecs/core";

import { Button } from "@/components/ui/button";
import { useEditorBridge } from "@/features/editor/editor-bridge";
import { useUiStore } from "@/lib/store/ui";
import { proposeEditSuggestion } from "@/lib/actions/ai";
import type { RefineMode } from "@forgespecs/ai/flows";

/**
 * AI selection toolbar: "Refine" / "Expand" on the current editor selection.
 *
 * Flow: read the selection from the editor bridge → stream `/api/ai/refine` →
 * show the streamed revision → on "Create suggestion" route it through
 * `proposeEditSuggestion` (→ M5 createSuggestion). The result is an APPROVABLE
 * SUGGESTION reviewed in the collaboration panel, never a hard overwrite.
 *
 * Also publishes the current selection text into the AI context store so the
 * chat panel can focus retrieval on what the user has highlighted.
 */
export function SelectionToolbar({
  documentId,
  scope,
}: {
  documentId: string;
  scope: Scope;
}) {
  const bridge = useEditorBridge();
  const setAiContext = useUiStore((s) => s.setAiContext);
  const [selText, setSelText] = React.useState("");
  const [selBlockId, setSelBlockId] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<RefineMode>("refine");
  const [streaming, setStreaming] = React.useState(false);
  const [result, setResult] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Poll the bridge for the current selection (BlockNote has no selection event
  // we subscribe to here; a light interval keeps the toolbar's snapshot fresh
  // and publishes it for chat context). Cheap — only reads in-memory state.
  React.useEffect(() => {
    const tick = (): void => {
      const sel = bridge?.getSelection?.() ?? null;
      const text = sel?.text ?? "";
      setSelText(text);
      setSelBlockId(sel?.blockId ?? null);
      setAiContext({ selectionText: text || null });
    };
    const id = setInterval(tick, 600);
    tick();
    return () => clearInterval(id);
  }, [bridge, setAiContext]);

  const hasSelection = selText.trim().length > 0;

  const run = async (m: RefineMode): Promise<void> => {
    if (!hasSelection) return;
    setMode(m);
    setOpen(true);
    setStreaming(true);
    setResult("");
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/ai/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selection: selText,
          mode: m,
          documentId,
          workspaceId: scope.workspaceId,
          projectId: scope.kind === "project" ? scope.projectId : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        setError("AI request failed.");
        setStreaming(false);
        return;
      }
      // Distinguish the graceful JSON "ai_unavailable" from a text stream.
      const ctype = res.headers.get("content-type") ?? "";
      if (ctype.includes("application/json")) {
        const j = (await res.json()) as { message?: string };
        setError(j.message ?? "AI is unavailable.");
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setResult(acc);
      }
    } catch {
      setError("AI request failed.");
    } finally {
      setStreaming(false);
    }
  };

  const createSuggestion = async (): Promise<void> => {
    if (!result.trim() || !selBlockId) return;
    setSaving(true);
    setError(null);
    try {
      await proposeEditSuggestion({
        documentId,
        proposedText: result,
        blockId: selBlockId,
        rationale: `AI ${mode} of selection`,
        scope,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create suggestion.");
    } finally {
      setSaving(false);
    }
  };

  const close = (): void => {
    setOpen(false);
    setResult("");
    setError(null);
    setSaved(false);
  };

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!hasSelection || streaming}
          onClick={() => void run("refine")}
        >
          <Wand2 className="size-3.5" /> Refine with AI
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!hasSelection || streaming}
          onClick={() => void run("expand")}
        >
          <Sparkles className="size-3.5" /> Expand
        </Button>
        {!hasSelection ? (
          <span className="text-xs text-muted-foreground">
            Select text to refine or expand
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 rounded-md border bg-card p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              {mode === "expand" ? "Expanded" : "Refined"} (preview)
            </span>
            <button
              type="button"
              onClick={close}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-sm">
            {result || (streaming ? "…" : "")}
            {streaming ? (
              <Loader2 className="ml-1 inline size-3.5 animate-spin" />
            ) : null}
          </div>
          {error ? (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            {saved ? (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                Suggestion created — approve it in the panel.
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={streaming || saving || !result.trim() || !selBlockId}
                onClick={() => void createSuggestion()}
              >
                <Check className="size-3.5" />
                {saving ? "Creating…" : "Create suggestion"}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
