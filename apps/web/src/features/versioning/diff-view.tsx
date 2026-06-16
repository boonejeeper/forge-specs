"use client";

import * as React from "react";
import { Columns2, Rows3 } from "lucide-react";
import type {
  BlockDiffHunk,
  DocumentDiff,
  InlineSegment,
} from "@forgespecs/core";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Git-style diff renderer over the core diff model (M8). Two layouts:
 *  - side-by-side: before | after columns, hunks aligned by row.
 *  - inline: a single column with word-level add/remove highlighting.
 *
 * This renders the *renderable diff model* produced by the pure core engine
 * (block-level hunks + inline word segments) — no jsondiffpatch or BlockNote in
 * the UI. It is part of the code-split `[rev]` segment, kept off the editor path.
 */
export type DiffMode = "split" | "inline";

const OP_LABEL: Record<BlockDiffHunk["op"], string> = {
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  changed: "Changed",
  unchanged: "",
};

const OP_ACCENT: Record<BlockDiffHunk["op"], string> = {
  added: "border-l-emerald-500",
  removed: "border-l-red-500",
  moved: "border-l-amber-500",
  changed: "border-l-blue-500",
  unchanged: "border-l-transparent",
};

export function DiffView({
  diff,
  toolbar,
}: {
  diff: DocumentDiff;
  /** Optional trailing toolbar content (e.g. the Restore button). */
  toolbar?: React.ReactNode;
}) {
  const [mode, setMode] = React.useState<DiffMode>("split");
  const [showUnchanged, setShowUnchanged] = React.useState(false);

  const visible = showUnchanged
    ? diff.hunks
    : diff.hunks.filter((h) => h.op !== "unchanged");

  const { added, removed, changed, moved } = diff.stats;
  const isEmpty = added + removed + changed + moved === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {added > 0 ? <span className="text-emerald-600 dark:text-emerald-400">+{added} added</span> : null}
          {removed > 0 ? <span className="text-red-600 dark:text-red-400">−{removed} removed</span> : null}
          {changed > 0 ? <span className="text-blue-600 dark:text-blue-400">~{changed} changed</span> : null}
          {moved > 0 ? <span className="text-amber-600 dark:text-amber-400">⇅{moved} moved</span> : null}
          {isEmpty ? <span>No changes between these versions</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Show unchanged
          </label>
          <div className="flex overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => setMode("split")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs",
                mode === "split"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Columns2 className="size-3.5" />
              Split
            </button>
            <button
              type="button"
              onClick={() => setMode("inline")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs",
                mode === "inline"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Rows3 className="size-3.5" />
              Inline
            </button>
          </div>
          {toolbar}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {isEmpty
              ? "These versions are identical."
              : "Only unchanged blocks — toggle “Show unchanged” to view."}
          </p>
        ) : (
          <div className="space-y-2 font-mono text-xs leading-relaxed">
            {visible.map((h) =>
              mode === "split" ? (
                <SplitHunk key={h.id} hunk={h} />
              ) : (
                <InlineHunk key={h.id} hunk={h} />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HunkLabel({ hunk }: { hunk: BlockDiffHunk }) {
  if (hunk.op === "unchanged") return null;
  return (
    <span
      className={cn(
        "mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        hunk.op === "added" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        hunk.op === "removed" && "bg-red-500/15 text-red-600 dark:text-red-400",
        hunk.op === "moved" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        hunk.op === "changed" && "bg-blue-500/15 text-blue-600 dark:text-blue-400",
      )}
    >
      {OP_LABEL[hunk.op]} · {hunk.blockType}
    </span>
  );
}

function SplitHunk({ hunk }: { hunk: BlockDiffHunk }) {
  return (
    <div className={cn("rounded-md border border-l-4 bg-card", OP_ACCENT[hunk.op])}>
      <div className="px-3 pt-2">
        <HunkLabel hunk={hunk} />
      </div>
      <div className="grid grid-cols-2 divide-x">
        <pre className={cn("overflow-x-auto whitespace-pre-wrap break-words px-3 py-2", hunk.op === "removed" && "bg-red-500/5", hunk.op === "changed" && "bg-red-500/5")}>
          {hunk.before || <span className="text-muted-foreground">—</span>}
        </pre>
        <pre className={cn("overflow-x-auto whitespace-pre-wrap break-words px-3 py-2", hunk.op === "added" && "bg-emerald-500/5", hunk.op === "changed" && "bg-emerald-500/5")}>
          {hunk.after || <span className="text-muted-foreground">—</span>}
        </pre>
      </div>
    </div>
  );
}

function InlineHunk({ hunk }: { hunk: BlockDiffHunk }) {
  return (
    <div className={cn("rounded-md border border-l-4 bg-card", OP_ACCENT[hunk.op])}>
      <div className="px-3 pt-2">
        <HunkLabel hunk={hunk} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 pb-2">
        {hunk.op === "changed" && hunk.inline ? (
          <InlineSegments segments={hunk.inline} />
        ) : hunk.op === "added" ? (
          <span className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">{hunk.after}</span>
        ) : hunk.op === "removed" ? (
          <span className="bg-red-500/15 text-red-700 line-through dark:text-red-300">{hunk.before}</span>
        ) : (
          hunk.after || <span className="text-muted-foreground">—</span>
        )}
      </pre>
    </div>
  );
}

function InlineSegments({ segments }: { segments: InlineSegment[] }) {
  return (
    <>
      {segments.map((s, i) => (
        <span
          key={i}
          className={cn(
            s.type === "added" && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
            s.type === "removed" && "bg-red-500/20 text-red-700 line-through dark:text-red-300",
          )}
        >
          {s.value}
        </span>
      ))}
    </>
  );
}
