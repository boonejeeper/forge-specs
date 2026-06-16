import Link from "next/link";
import { notFound } from "next/navigation";
import { Database } from "lucide-react";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { listSchemaDocs } from "@/lib/data/visual-docs";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

/**
 * Project schema overview (M9). Lists the project's DB_SCHEMA documents; each
 * links to its full-bleed ERD designer. The ERD itself (React Flow) is rendered
 * on the per-doc route and code-split.
 */
export default async function ProjectSchemaPage({
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

  const docs = await listSchemaDocs(project.id);
  const base = `/${workspaceSlug}/${projectSlug}/schema`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PageHeader
        title="Schema"
        description="Entity-relationship diagrams for this project's database schema documents."
      />
      {docs.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No schema documents"
          description="Create a DB_SCHEMA document with a DBML block or Mermaid erDiagram to design its ERD here."
        />
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id}>
              <Link
                href={`${base}/${d.id}`}
                className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent"
              >
                <Database className="size-5 text-amber-500" />
                <span className="text-sm font-medium">{d.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
