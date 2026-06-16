import { notFound } from "next/navigation";
import { prisma } from "@forgespecs/db";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getDocument } from "@/lib/data/documents";
import { getNeighborhoodGraph } from "@/lib/data/graph";
import { can } from "@/lib/auth/rbac";
import { DependencyGraphPanel } from "@/features/graph/dependency-graph-panel";

/**
 * Per-spec dependency neighborhood (M9). Renders the 1–2 hop graph around this
 * document — built from the recursive-CTE crossref closure (both directions) —
 * with the seed highlighted. Clicking any node opens it. The graph spans
 * projects (dependencies can cross), so we resolve each node's project slug for
 * correct navigation. Heavy React Flow libs are code-split (dynamic ssr:false).
 */
export default async function SpecGraphPage({
  params,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    specId: string;
  }>;
}) {
  const { workspaceSlug, projectSlug, specId } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();
  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();
  const doc = await getDocument(specId);
  if (!doc || doc.projectId !== project.id) notFound();

  const scope = {
    kind: "project" as const,
    workspaceId: workspace.id,
    projectId: project.id,
  };
  if (!(await can(scope, "doc.read"))) notFound();

  const graph = await getNeighborhoodGraph(specId, 2);

  const projectSlugByDoc: Record<string, string> = {};
  if (graph.nodes.length > 0) {
    const rows = await prisma.document.findMany({
      where: { id: { in: graph.nodes.map((n) => n.id) } },
      select: { id: true, project: { select: { slug: true } } },
    });
    for (const r of rows) projectSlugByDoc[r.id] = r.project.slug;
  }

  return (
    <div className="h-full min-h-[480px] w-full">
      <DependencyGraphPanel
        graph={graph}
        workspaceSlug={workspaceSlug}
        projectSlugByDoc={projectSlugByDoc}
        fallbackProjectSlug={projectSlug}
        seedId={specId}
      />
    </div>
  );
}
