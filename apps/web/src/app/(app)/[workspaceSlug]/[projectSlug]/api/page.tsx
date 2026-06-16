import Link from "next/link";
import { notFound } from "next/navigation";
import { FileJson } from "lucide-react";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { listApiDocs } from "@/lib/data/visual-docs";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

/**
 * Project API overview (M9). Lists the project's API_SPEC documents; each links
 * to its full-bleed OpenAPI explorer (Scalar), rendered + code-split on the
 * per-doc route.
 */
export default async function ProjectApiPage({
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

  const docs = await listApiDocs(project.id);
  const base = `/${workspaceSlug}/${projectSlug}/api`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PageHeader
        title="API"
        description="Interactive OpenAPI references for this project's API specification documents."
      />
      {docs.length === 0 ? (
        <EmptyState
          icon={FileJson}
          title="No API specifications"
          description="Create an API_SPEC document with an OpenAPI 3.1 YAML or JSON block to explore it here."
        />
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id}>
              <Link
                href={`${base}/${d.id}`}
                className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent"
              >
                <FileJson className="size-5 text-emerald-500" />
                <span className="text-sm font-medium">{d.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
