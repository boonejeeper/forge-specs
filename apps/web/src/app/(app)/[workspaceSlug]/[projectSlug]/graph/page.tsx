import { notFound } from "next/navigation";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getProjectGraph } from "@/lib/data/graph";
import { can } from "@/lib/auth/rbac";
import { DependencyGraphPanel } from "@/features/graph/dependency-graph-panel";

/**
 * Per-project dependency graph (M9). The interactive React Flow DAG renders the
 * project's Dependency edges as a hierarchical graph; clicking a node opens the
 * doc. Full-bleed + the heavy graph libs are code-split (dynamic ssr:false in
 * the panel) so this never weighs on the editor route.
 *
 * RBAC: the data fn restricts nodes/edges to the reader's allow-list.
 */
export default async function ProjectGraphPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();
  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();

  const scope = {
    kind: "project" as const,
    workspaceId: workspace.id,
    projectId: project.id,
  };
  if (!(await can(scope, "doc.read"))) notFound();

  const graph = await getProjectGraph(workspace.id, project.id);

  return (
    <div className="h-full w-full">
      <DependencyGraphPanel
        graph={graph}
        workspaceSlug={workspaceSlug}
        fallbackProjectSlug={projectSlug}
      />
    </div>
  );
}
