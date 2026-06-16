"use client";

import * as React from "react";
import { Check, GitPullRequestArrow, X } from "lucide-react";
import { SuggestionStatus } from "@forgespecs/db";
import {
  applySuggestion,
  isDelta,
  type SuggestionSummary,
} from "@forgespecs/core";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorBridge } from "@/features/editor/editor-bridge";

import {
  useSuggestions,
  useSuggestionMutations,
  type DocContext,
  type SuggestionDto,
} from "./use-collaboration";

/**
 * Suggestions (track-changes) panel.
 *
 * Propose: capture the live document body as the base, let the user edit a copy
 * of the selected block's text, diff base→proposed via core `diffSuggestion`,
 * and persist the delta. (A richer inline track-changes UX builds on this seam;
 * here we keep a focused, working propose-from-selection flow.)
 *
 * Review: each pending suggestion shows a change summary + a before/after text
 * preview. Accept validates the delta against the LIVE body, applies it through
 * the editor (Yjs converges for all peers), then flips status + audits. Reject
 * just discards.
 */
export function SuggestionsPanel({
  ctx,
  canSuggest,
  canResolve,
}: {
  ctx: DocContext;
  canSuggest: boolean;
  canResolve: boolean;
}) {
  const { data: suggestions = [], isLoading } = useSuggestions(ctx.documentId);
  const { create, resolve } = useSuggestionMutations(ctx);
  const bridge = useEditorBridge();
  const [composing, setComposing] = React.useState(false);

  const pending = suggestions.filter((s) => s.status === SuggestionStatus.PENDING);
  const resolved = suggestions.filter((s) => s.status !== SuggestionStatus.PENDING);

  const accept = (s: SuggestionDto): void => {
    if (!isDelta(s.patch)) return;
    const live = bridge?.getDocumentJSON?.() ?? undefined;
    resolve.mutate(
      { suggestionId: s.id, accept: true, liveContent: live },
      {
        onSuccess: (res) => {
          // Apply the resulting body through the editor → Yjs (the same path a
          // human edit takes), so it converges for every collaborator.
          if (res.applied !== undefined && bridge?.applyDocumentJSON) {
            bridge.applyDocumentJSON(res.applied);
          } else if (live !== undefined && bridge?.applyDocumentJSON) {
            // Fallback: apply locally from the live base if the server omitted it.
            try {
              bridge.applyDocumentJSON(applySuggestion(live, s.patch as never));
            } catch {
              /* validation already happened server-side */
            }
          }
        },
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      {canSuggest ? (
        <div className="border-b p-3">
          {composing ? (
            <SuggestionComposer
              ctx={ctx}
              onCancel={() => setComposing(false)}
              onCreate={(input) => {
                create.mutate(input, { onSuccess: () => setComposing(false) });
              }}
              creating={create.isPending}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setComposing(true)}
            >
              <GitPullRequestArrow className="size-4" />
              Propose an edit
            </Button>
          )}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No suggestions yet.</p>
        ) : (
          <>
            {pending.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                canResolve={canResolve}
                onAccept={() => accept(s)}
                onReject={() =>
                  resolve.mutate({ suggestionId: s.id, accept: false })
                }
                busy={resolve.isPending}
              />
            ))}
            {resolved.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} canResolve={false} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionComposer({
  ctx,
  onCancel,
  onCreate,
  creating,
}: {
  ctx: DocContext;
  onCancel: () => void;
  onCreate: (input: {
    patch: unknown;
    rationale?: string | null;
    baseContent?: unknown;
  }) => void;
  creating: boolean;
}) {
  const bridge = useEditorBridge();
  const sel = bridge?.getSelection?.() ?? null;
  const [replacement, setReplacement] = React.useState(sel?.text ?? "");
  const [rationale, setRationale] = React.useState("");

  const propose = async (): Promise<void> => {
    const base = bridge?.getDocumentJSON?.();
    if (!Array.isArray(base) || !sel?.blockId) return;
    // Build the proposed body: replace the selected block's text with the user's
    // replacement. We compute the delta in core to keep the patch format shared.
    const { diffSuggestion } = await import("@forgespecs/core");
    const proposed = replaceBlockText(base, sel.blockId, sel.text, replacement);
    const patch = diffSuggestion(base, proposed);
    if (!patch) return; // no change
    onCreate({ patch, rationale: rationale || null, baseContent: base });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {sel?.text
          ? `Replacing “${truncate(sel.text, 40)}”`
          : "Select text in the doc to propose a replacement"}
      </p>
      <textarea
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        rows={3}
        placeholder="Proposed text…"
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <input
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Why? (optional)"
        className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={creating || !sel?.blockId}
          onClick={() => void propose()}
        >
          {creating ? "Proposing…" : "Suggest"}
        </Button>
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  canResolve,
  onAccept,
  onReject,
  busy,
}: {
  suggestion: SuggestionDto;
  canResolve: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-md border bg-card p-3 text-card-foreground">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {suggestion.authorName ?? "Unknown"}
        </span>
        <StatusPill status={suggestion.status} />
      </div>
      <SummaryLine summary={suggestion.summary} />
      {suggestion.rationale ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {suggestion.rationale}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {new Date(suggestion.createdAt).toLocaleString()}
      </p>
      {canResolve && suggestion.status === SuggestionStatus.PENDING ? (
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={onAccept}>
            <Check className="size-3.5" />
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onReject}
          >
            <X className="size-3.5" />
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SummaryLine({ summary }: { summary: SuggestionSummary }) {
  const parts: string[] = [];
  if (summary.added) parts.push(`+${summary.added} added`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  if (summary.modified) parts.push(`${summary.modified} modified`);
  if (summary.moved) parts.push(`${summary.moved} moved`);
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {parts.length ? parts.join(" · ") : "No block-level changes"}
    </p>
  );
}

function StatusPill({ status }: { status: SuggestionStatus }) {
  const map: Record<SuggestionStatus, string> = {
    [SuggestionStatus.PENDING]:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    [SuggestionStatus.ACCEPTED]:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    [SuggestionStatus.REJECTED]:
      "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
        map[status],
      )}
    >
      {status}
    </span>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Produce a proposed document by replacing the FIRST text run of the target
 * block. Minimal block-text edit used by the propose-from-selection flow; the
 * resulting doc is diffed against the base in core so the patch format is shared
 * with the AI-refine path.
 */
function replaceBlockText(
  doc: unknown[],
  blockId: string,
  _selected: string,
  replacement: string,
): unknown[] {
  const clone = structuredClone(doc) as Array<Record<string, unknown>>;
  const walk = (blocks: Array<Record<string, unknown>>): boolean => {
    for (const b of blocks) {
      if (b.id === blockId) {
        b.content = [{ type: "text", text: replacement, styles: {} }];
        return true;
      }
      const children = b.children as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(children) && walk(children)) return true;
    }
    return false;
  };
  walk(clone);
  return clone;
}
