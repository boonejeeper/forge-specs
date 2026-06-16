import { notFound } from "next/navigation";

import { Topbar } from "@/components/shell/topbar";
import { WorkspaceSidebar } from "@/components/shell/workspace-sidebar";
import { WorkspaceProvider } from "@/lib/context/workspace-context";
import { Hydrate } from "@/lib/query/hydrate";
import { queryKeys } from "@/lib/query/keys";
import {
  getWorkspaceBySlug,
  listWorkspacesForCurrentUser,
} from "@/lib/data/workspaces";
import { listProjects } from "@/lib/data/projects";

/**
 * Workspace context layer. Resolves the workspace from the slug, seeds the
 * project list into the Query cache (so the sidebar paints instantly and is
 * client-interactive without a refetch), and provides workspace context to all
 * nested client components.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [workspace, workspaces] = await Promise.all([
    getWorkspaceBySlug(workspaceSlug),
    listWorkspacesForCurrentUser(),
  ]);

  if (!workspace) notFound();

  return (
    <WorkspaceProvider
      value={{
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
      }}
    >
      <Hydrate
        prefetch={async (qc) => {
          await qc.prefetchQuery({
            queryKey: queryKeys.projects.list(workspace.id),
            queryFn: () => listProjects(workspace.id),
          });
        }}
      >
        <WorkspaceSidebar workspaces={workspaces} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </Hydrate>
    </WorkspaceProvider>
  );
}
