"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Sparkles } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useUiStore } from "@/lib/store/ui";
import {
  formatKeys,
  useKeyboardRegistry,
  type Shortcut,
} from "@/lib/keyboard/registry";
import { useSearch, type SearchHitDto } from "@/lib/query/use-search";
import { Highlight } from "@/components/search/highlight";
import { docTypeLabel } from "@forgespecs/core";
import type { DocumentType } from "@forgespecs/db";

/**
 * Command palette — two sources in one surface:
 *   1. Commands generated from the keyboard registry (single source of truth,
 *      so commands & shortcuts never drift).
 *   2. Live hybrid search (full-text + semantic + RRF) against /api/search,
 *      debounced via TanStack Query, results grouped by document type and
 *      keyboard-navigable; Enter navigates to the doc.
 *
 * cmdk owns keyboard navigation across both sections. We disable cmdk's own
 * fuzzy filtering (`shouldFilter={false}`) for search items because the server
 * already ranks them; command items keep their static labels and are matched by
 * cmdk against the same query.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const shortcuts = useKeyboardRegistry((s) => s.shortcuts);
  const router = useRouter();

  const [query, setQuery] = React.useState("");

  // Reset the query each time the palette closes so it reopens clean.
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const search = useSearch({ q: query, mode: "all", enabled: open });

  const commandItems = React.useMemo(() => {
    const visible = [...shortcuts.values()].filter(
      (s) => s.showInPalette !== false && (!s.when || s.when()),
    );
    const byGroup = new Map<string, Shortcut[]>();
    for (const s of visible) {
      const arr = byGroup.get(s.group) ?? [];
      arr.push(s);
      byGroup.set(s.group, arr);
    }
    return [...byGroup.entries()];
  }, [shortcuts]);

  const runCommand = React.useCallback(
    (s: Shortcut) => {
      setOpen(false);
      requestAnimationFrame(() => s.handler(null));
    },
    [setOpen],
  );

  const goToDoc = React.useCallback(
    (hit: SearchHitDto) => {
      setOpen(false);
      router.push(
        `/${hit.workspaceSlug}/${hit.projectSlug}/specs/${hit.documentId}`,
      );
    },
    [router, setOpen],
  );

  // Group search hits by document type, preserving rank order within a group.
  const searchGroups = React.useMemo(() => {
    const results = search.data?.results ?? [];
    const byType = new Map<string, SearchHitDto[]>();
    for (const r of results) {
      const arr = byType.get(r.type) ?? [];
      arr.push(r);
      byType.set(r.type, arr);
    }
    return [...byType.entries()];
  }, [search.data]);

  const hasQuery = query.trim().length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search specs or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {hasQuery && search.isFetching ? "Searching…" : "No results found."}
        </CommandEmpty>

        {hasQuery && searchGroups.length > 0 ? (
          <>
            {search.data?.semanticAvailable === false ? (
              <div className="px-3 py-1 text-[11px] text-muted-foreground">
                Text search · enable AI for semantic results
              </div>
            ) : null}
            {searchGroups.map(([type, hits]) => (
              <CommandGroup
                key={`search-${type}`}
                heading={docTypeLabel(type as DocumentType)}
              >
                {hits.map((hit) => (
                  <CommandItem
                    key={hit.documentId}
                    value={`doc-${hit.documentId}`}
                    onSelect={() => goToDoc(hit)}
                  >
                    <FileText className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{hit.title}</span>
                      {hit.snippet ? (
                        <Highlight
                          snippet={hit.snippet}
                          className="truncate text-xs text-muted-foreground"
                        />
                      ) : null}
                    </span>
                    {hit.matchedSemantic ? (
                      <Sparkles className="ml-auto size-3.5 shrink-0 text-violet-500" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </>
        ) : null}

        {/* Commands show when the input is empty (command-menu mode); once the
            user types, the surface becomes a search-results list. */}
        {!hasQuery
          ? commandItems.map(([group, groupShortcuts]) => (
              <CommandGroup key={group} heading={group}>
                {groupShortcuts.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`${s.group} ${s.label}`}
                    onSelect={() => runCommand(s)}
                  >
                    <span>{s.label}</span>
                    {s.keys[0] ? (
                      <CommandShortcut>{formatKeys(s.keys[0])}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))
          : null}
      </CommandList>
    </CommandDialog>
  );
}
