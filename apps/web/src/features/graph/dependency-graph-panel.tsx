"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Network } from "lucide-react";

import type { GraphModel, GraphDocType } from "@forgespecs/core/graph";
import { EmptyState } from "@/components/empty-state";
import { EDGE_KIND_STYLE } from "./doc-node-meta";

/**
 * Client entry for the dependency graph. React Flow + dagre are heavy and only
 * needed on this full-bleed surface, so the inner `DependencyGraph` is loaded
 * via next/dynamic with ssr:false — keeping it out of the editor route's bundle
 * and off the server render path.
 */
const DependencyGraph = dynamic(() => import("./DependencyGraph"), {
  ssr: false,
  loading: () => <GraphSkeleton />,
});

function GraphSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

export function DependencyGraphPanel({
  graph,
  workspaceSlug,
  projectSlugByDoc,
  fallbackProjectSlug,
  seedId,
}: {
  graph: GraphModel;
  workspaceSlug: string;
  /** doc id → its project slug (neighborhood can cross projects). */
  projectSlugByDoc?: Record<string, string>;
  /** Project slug to use when a doc isn't in the cross-project map. */
  fallbackProjectSlug: string;
  seedId?: string;
}) {
  const hrefForNode = React.useCallback(
    (node: GraphModel["nodes"][number]) => {
      const proj = projectSlugByDoc?.[node.id] ?? fallbackProjectSlug;
      return `/${workspaceSlug}/${proj}/specs/${node.id}`;
    },
    [workspaceSlug, projectSlugByDoc, fallbackProjectSlug],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={Network}
          title="Nothing to visualize yet"
          description="Create specs and link them with dependencies to populate the graph."
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <DependencyGraph graph={graph} hrefForNode={hrefForNode} seedId={seedId} />
      <GraphLegend />
    </div>
  );
}

const DOC_LEGEND: { type: GraphDocType; label: string; color: string }[] = [
  { type: "VISION", label: "Vision", color: "#8b5cf6" },
  { type: "RFC", label: "RFC", color: "#3b82f6" },
  { type: "ADR", label: "ADR", color: "#06b6d4" },
  { type: "API_SPEC", label: "API", color: "#10b981" },
  { type: "DB_SCHEMA", label: "Schema", color: "#f59e0b" },
];

function GraphLegend() {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border bg-card/90 p-3 text-xs shadow-sm backdrop-blur">
      <p className="mb-1.5 font-medium">Edges</p>
      <ul className="space-y-1">
        {Object.entries(EDGE_KIND_STYLE).map(([kind, s]) => (
          <li key={kind} className="flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5"
              style={{
                backgroundColor: s.color,
                ...(s.dashed
                  ? { backgroundImage: "none", borderTop: `1px dashed ${s.color}` }
                  : {}),
              }}
            />
            <span className="text-muted-foreground">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
