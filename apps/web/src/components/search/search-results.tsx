"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Search as SearchIcon, Sparkles, Type } from "lucide-react";

import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/document/status-badge";
import { Highlight } from "@/components/search/highlight";
import { useSearch, type SearchMode } from "@/lib/query/use-search";
import { docTypeLabel } from "@forgespecs/core";
import type { DocumentStatus, DocumentType } from "@forgespecs/db";
import { cn } from "@/lib/utils";

const MODES: { value: SearchMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "text", label: "Text" },
  { value: "semantic", label: "Semantic" },
];

export function SearchResults({
  workspaceId,
  initialQuery,
  projects,
}: {
  workspaceId: string;
  initialQuery: string;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState(initialQuery);
  const [mode, setMode] = React.useState<SearchMode>("all");
  const [typeFilter, setTypeFilter] = React.useState<string>("");
  const [projectFilter, setProjectFilter] = React.useState<string>("");

  // Keep the URL ?q= in sync so results are shareable/back-button friendly.
  React.useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      router.replace(`?${params.toString()}`, { scroll: false });
    }, 400);
    return () => clearTimeout(t);
  }, [query, router]);

  const search = useSearch({
    q: query,
    workspaceId,
    projectId: projectFilter || undefined,
    mode,
  });

  const results = React.useMemo(() => {
    const all = search.data?.results ?? [];
    return typeFilter ? all.filter((r) => r.type === typeFilter) : all;
  }, [search.data, typeFilter]);

  const docTypes = React.useMemo(() => {
    const types = new Set((search.data?.results ?? []).map((r) => r.type));
    return [...types];
  }, [search.data]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search specs…"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Mode toggle */}
        <div className="inline-flex rounded-md border border-input p-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                mode === m.value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Project filter */}
        {projects.length > 0 ? (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}

        {/* Type filter (derived from current results) */}
        {docTypes.length > 1 ? (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
          >
            <option value="">All types</option>
            {docTypes.map((t) => (
              <option key={t} value={t}>
                {docTypeLabel(t as DocumentType)}
              </option>
            ))}
          </select>
        ) : null}

        {search.data && mode !== "text" && !search.data.semanticAvailable ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Type className="size-3.5" />
            Text only · set OPENROUTER_API_KEY for semantic
          </span>
        ) : null}
      </div>

      {!query.trim() ? (
        <EmptyState
          icon={SearchIcon}
          title="Search your specs"
          description="Find documents by keyword or meaning across the workspace."
        />
      ) : results.length === 0 && !search.isFetching ? (
        <EmptyState
          icon={SearchIcon}
          title="No matches"
          description="Try different keywords or switch search mode."
        />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {results.map((hit) => (
            <li key={hit.documentId}>
              <Link
                href={`/${hit.workspaceSlug}/${hit.projectSlug}/specs/${hit.documentId}`}
                className="flex flex-col gap-1 px-4 py-3 hover:bg-accent/50"
              >
                <div className="flex items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{hit.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {docTypeLabel(hit.type as DocumentType)}
                  </span>
                  <StatusBadge
                    status={hit.status as DocumentStatus}
                    className="ml-1"
                  />
                  {hit.matchedSemantic ? (
                    <Sparkles className="ml-auto size-3.5 shrink-0 text-violet-500" />
                  ) : null}
                </div>
                {hit.snippet ? (
                  <Highlight
                    snippet={hit.snippet}
                    className="line-clamp-2 pl-6 text-sm text-muted-foreground"
                  />
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
