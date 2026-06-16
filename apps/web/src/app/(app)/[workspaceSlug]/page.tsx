import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderOpen } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { listProjects } from "@/lib/data/projects";

export default async function WorkspaceOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const projects = (await listProjects(workspace.id)).filter(
    (p) => !p.archived,
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <PageHeader
        title={workspace.name}
        description="Pick a project to open its spec repository."
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Create a project from the sidebar to start authoring specs."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/${workspace.slug}/${p.slug}`}
              className="rounded-lg border p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center gap-2">
                <FolderOpen className="size-4 text-muted-foreground" />
                <span className="font-medium">{p.name}</span>
              </div>
              {p.description ? (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {p.description}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                {p.documentCount} document{p.documentCount === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
