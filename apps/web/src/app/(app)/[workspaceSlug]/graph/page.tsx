import { notFound } from "next/navigation";
import { prisma } from "@forgespecs/db";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getWorkspaceGraph } from "@/lib/data/graph";
import { KnowledgeGraphPanel } from "@/features/graph/knowledge-graph-panel";

/**
 * Workspace-wide knowledge graph (M9): an Obsidian-style WebGL force-directed
 * view (Sigma + graphology) over every readable doc + dependency across the
 * workspace's projects. Full-bleed; the Sigma bundle is code-split (dynamic
 * ssr:false). RBAC scoping happens in `getWorkspaceGraph`.
 */
export default async function WorkspaceGraphPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const graph = await getWorkspaceGraph(workspace.id);

  // doc id → project slug, so clicking a node opens the right project's route.
  const projectSlugByDoc: Record<string, string> = {};
  if (graph.nodes.length > 0) {
    const rows = await prisma.document.findMany({
      where: { id: { in: graph.nodes.map((n) => n.id) } },
      select: { id: true, project: { select: { slug: true } } },
    });
    for (const r of rows) projectSlugByDoc[r.id] = r.project.slug;
  }

  return (
    <div className="h-full w-full">
      <KnowledgeGraphPanel
        graph={graph}
        workspaceSlug={workspaceSlug}
        projectSlugByDoc={projectSlugByDoc}
      />
    </div>
  );
}
