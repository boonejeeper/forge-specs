"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Network } from "lucide-react";

import type { GraphModel } from "@forgespecs/core/graph";
import { EmptyState } from "@/components/empty-state";

/**
 * Client entry for the workspace knowledge graph. Sigma + graphology +
 * ForceAtlas2 are loaded via next/dynamic (ssr:false) — WebGL can't render on
 * the server, and this weight must stay off the editor route.
 */
const KnowledgeGraph = dynamic(() => import("./KnowledgeGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  ),
});

export function KnowledgeGraphPanel({
  graph,
  workspaceSlug,
  projectSlugByDoc,
}: {
  graph: GraphModel;
  workspaceSlug: string;
  /** doc id → its project slug (the knowledge graph spans the workspace). */
  projectSlugByDoc: Record<string, string>;
}) {
  const hrefForNode = React.useCallback(
    (id: string) => {
      const proj = projectSlugByDoc[id];
      return proj ? `/${workspaceSlug}/${proj}/specs/${id}` : `/${workspaceSlug}`;
    },
    [workspaceSlug, projectSlugByDoc],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={Network}
          title="Your knowledge graph is empty"
          description="As specs and their dependencies grow across projects, they appear here as a connected web."
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <KnowledgeGraph graph={graph} hrefForNode={hrefForNode} />
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border bg-card/90 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
        {graph.nodes.length} docs · {graph.edges.length} links · hover to focus,
        click to open
      </div>
    </div>
  );
}
