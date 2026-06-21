import { notFound } from "next/navigation";

import { ProjectProvider } from "@/lib/context/workspace-context";
import { Hydrate } from "@/lib/query/hydrate";
import { queryKeys } from "@/lib/query/keys";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getDocumentTree } from "@/lib/data/documents";
import { SpecTreePanel } from "@/components/document/spec-tree-panel";
import { GenerateRfcDialog } from "@/features/generate/generate-rfc-dialog";

/**
 * Project context layer. Resolves the project, seeds the spec tree into the
 * Query cache, provides project context, and renders the spec-tree panel as a
 * second column beside the routed content (overview, doc view, sub-views).
 *
 * The AI chat panel is mounted at the app-shell layer (`(app)/layout.tsx`) so
 * it persists across ALL signed-in navigation — not just within a project.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();

  return (
    <ProjectProvider
      value={{
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
      }}
    >
      <Hydrate
        prefetch={async (qc) => {
          await qc.prefetchQuery({
            queryKey: queryKeys.documents.tree(project.id),
            queryFn: () => getDocumentTree(project.id),
          });
        }}
      >
        <div className="flex min-h-0 flex-1">
          <SpecTreePanel projectName={project.name} />
          <div className="min-w-0 flex-1 overflow-auto">{children}</div>
        </div>
        <GenerateRfcDialog />
      </Hydrate>
    </ProjectProvider>
  );
}
