"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Network } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/document/status-badge";
import { useCrossReferences } from "@/lib/query/use-search";
import type { CrossRefResponse } from "@/lib/query/use-search";
import { docTypeLabel } from "@forgespecs/core";
import type { DocumentStatus, DocumentType } from "@forgespecs/db";

/**
 * Cross-reference / impact panel for a document, backed by the recursive-CTE
 * crossref endpoint. Shows the transitive dependency closure in both
 * directions: outgoing (what this depends on) and incoming (what depends on it —
 * the blast radius of a change). The interactive graph is M9; this is the M3
 * data surface.
 */
export function CrossReferencePanel({
  documentId,
  workspaceSlug,
  projectSlug,
}: {
  documentId: string;
  workspaceSlug: string;
  projectSlug: string;
}) {
  const { data, isLoading, isError } = useCrossReferences(documentId);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-hidden>
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-16 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={Network}
        title="Couldn't load cross-references"
        description="Try again once the database is reachable."
      />
    );
  }

  const empty =
    data.incoming.length === 0 && data.outgoing.length === 0;
  if (empty) {
    return (
      <EmptyState
        icon={Network}
        title="No dependencies yet"
        description="Link this spec to others (implements / references / supersedes) to see its impact graph."
      />
    );
  }

  const linkFor = (id: string) =>
    `/${workspaceSlug}/${projectSlug}/specs/${id}`;

  return (
    <div className="space-y-8">
      <Section
        title="Depends on"
        hint="Specs this document references, transitively."
        icon={ArrowUpRight}
        items={data.outgoing}
        linkFor={linkFor}
      />
      <Section
        title="Referenced by"
        hint="Specs that depend on this one — the impact of changing it."
        icon={ArrowDownLeft}
        items={data.incoming}
        linkFor={linkFor}
      />
    </div>
  );
}

function Section({
  title,
  hint,
  icon: Icon,
  items,
  linkFor,
}: {
  title: string;
  hint: string;
  icon: typeof Network;
  items: CrossRefResponse["incoming"];
  linkFor: (id: string) => string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((it) => (
            <li key={it.documentId}>
              <Link
                href={linkFor(it.documentId)}
                className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50"
              >
                <span className="font-medium">{it.title}</span>
                <span className="text-xs text-muted-foreground">
                  {docTypeLabel(it.type as DocumentType)}
                </span>
                <StatusBadge status={it.status as DocumentStatus} />
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {it.kind.toLowerCase()}
                  {it.depth > 1 ? ` · ${it.depth} hops` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
