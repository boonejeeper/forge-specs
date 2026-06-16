"use client";

import * as React from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import type {
  SearchResponse,
  SearchHitDto,
} from "@/app/api/search/route";
import type { CrossRefResponse } from "@/app/api/documents/[documentId]/crossref/route";

export type SearchMode = "all" | "text" | "semantic";

export type { SearchHitDto, SearchResponse, CrossRefResponse };

const DEBOUNCE_MS = 200;

/** Debounce a rapidly-changing value (e.g. a search input). */
export function useDebounced<T>(value: T, ms = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export interface UseSearchArgs {
  q: string;
  workspaceId?: string;
  projectId?: string;
  mode?: SearchMode;
  /** Disable the query (e.g. palette closed) without unmounting. */
  enabled?: boolean;
}

async function fetchSearch(args: UseSearchArgs): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: args.q });
  if (args.workspaceId) params.set("workspaceId", args.workspaceId);
  if (args.projectId) params.set("projectId", args.projectId);
  if (args.mode) params.set("mode", args.mode);

  const res = await fetch(`/api/search?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return (await res.json()) as SearchResponse;
}

/**
 * Debounced hybrid search hook backed by `/api/search`. Used by both the
 * command palette and the dedicated /search results page. `keepPreviousData`
 * avoids flicker between keystrokes; results only fetch once the (debounced)
 * query is non-empty.
 */
export function useSearch(args: UseSearchArgs) {
  const debouncedQ = useDebounced(args.q);
  const trimmed = debouncedQ.trim();
  const enabled = (args.enabled ?? true) && trimmed.length > 0;

  return useQuery({
    queryKey: queryKeys.search.query({
      q: trimmed,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      mode: args.mode,
    }),
    queryFn: () =>
      fetchSearch({
        q: trimmed,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        mode: args.mode,
      }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

async function fetchCrossref(documentId: string): Promise<CrossRefResponse> {
  const res = await fetch(`/api/documents/${documentId}/crossref`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Cross-reference lookup failed: ${res.status}`);
  return (await res.json()) as CrossRefResponse;
}

/** Incoming/outgoing dependency closure for a document. */
export function useCrossReferences(documentId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.search.crossref(documentId),
    queryFn: () => fetchCrossref(documentId),
    enabled: enabled && Boolean(documentId),
    staleTime: 60 * 1000,
  });
}
