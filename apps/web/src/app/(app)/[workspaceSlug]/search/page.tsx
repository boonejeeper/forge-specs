import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { listProjects } from "@/lib/data/projects";
import { SearchResults } from "@/components/search/search-results";

/**
 * Dedicated search results page. Full hybrid results (full-text + semantic +
 * RRF) with type/project filters and a mode toggle (all / text / semantic).
 * RBAC is enforced by /api/search (results are scoped to the user's readable
 * docs); this page only provides the workspace + project list for the filters.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { q } = await searchParams;

  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const projects = await listProjects(workspace.id);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PageHeader
        title="Search"
        description="Hybrid full-text + semantic search across this workspace."
      />
      <SearchResults
        workspaceId={workspace.id}
        initialQuery={q ?? ""}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
