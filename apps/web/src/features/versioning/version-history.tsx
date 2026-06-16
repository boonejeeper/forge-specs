"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GitCompareArrows } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DocumentVersionSummary } from "@/lib/data/documents";

/**
 * Revision list (M8). Renders the document's versions newest-first with author,
 * timestamp, label and AI changelog summary. The user selects exactly two
 * versions to compare, then jumps to the diff sub-route. Long histories are
 * virtualized with TanStack Virtual so the list stays cheap.
 *
 * The diff/restore-heavy code lives on the `[rev]` sub-route, which is its own
 * code-split segment — this list does not pull react-diff-view or the diff
 * engine onto the editor hot path.
 */
export function VersionHistory({
  versions,
  base,
}: {
  /** Newest-first. */
  versions: DocumentVersionSummary[];
  /** Spec base path, e.g. /ws/proj/specs/abc */
  base: string;
}) {
  const router = useRouter();
  const parentRef = React.useRef<HTMLDivElement>(null);

  // Selection: up to two versionNums. Picking a third drops the oldest pick.
  const [selected, setSelected] = React.useState<number[]>([]);

  const toggle = (versionNum: number): void => {
    setSelected((prev) => {
      if (prev.includes(versionNum)) return prev.filter((n) => n !== versionNum);
      const next = [...prev, versionNum];
      return next.length > 2 ? next.slice(1) : next;
    });
  };

  const compare = (): void => {
    if (selected.length !== 2) return;
    const [x, y] = selected;
    const a = Math.min(x!, y!);
    const b = Math.max(x!, y!);
    // Route param is the "to" (newer) version; "from" carried as a query param.
    router.push(`${base}/history/${b}?from=${a}`);
  };

  const viewSingle = (versionNum: number): void => {
    // Diff a single version against its immediate predecessor.
    router.push(`${base}/history/${versionNum}`);
  };

  const rowVirtualizer = useVirtualizer({
    count: versions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {versions.length} snapshot{versions.length === 1 ? "" : "s"}
          {selected.length > 0
            ? ` · ${selected.length} selected`
            : " · select two to compare"}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={selected.length !== 2}
          onClick={compare}
        >
          <GitCompareArrows className="size-4" />
          Compare
        </Button>
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border"
      >
        <div
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          className="relative w-full"
        >
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const v = versions[vi.index]!;
            const isSelected = selected.includes(v.versionNum);
            return (
              <div
                key={v.id}
                className="absolute left-0 top-0 w-full"
                style={{
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <div
                  className={cn(
                    "flex h-full items-center gap-3 border-b px-4 text-sm last:border-b-0",
                    isSelected && "bg-accent/60",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select version ${v.versionNum}`}
                    checked={isSelected}
                    onChange={() => toggle(v.versionNum)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <button
                    type="button"
                    onClick={() => viewSingle(v.versionNum)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      v{v.versionNum}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {v.summary ?? `Version ${v.versionNum}`}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString()}
                        {v.authorName ? ` · ${v.authorName}` : ""}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
