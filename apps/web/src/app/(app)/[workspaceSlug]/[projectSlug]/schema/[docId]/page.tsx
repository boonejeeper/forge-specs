import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getErdForDocument } from "@/lib/data/visual-docs";
import { can } from "@/lib/auth/rbac";
import { ErdPanel } from "@/features/graph/erd-panel";

/**
 * Per-document ERD designer (M9). Parses the DB_SCHEMA document's DBML/Mermaid
 * erDiagram into a table model and renders the editable React Flow ERD with
 * SQL/DBML export. Full-bleed; React Flow + @dbml/core are code-split.
 */
export default async function SchemaDocPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string; docId: string }>;
}) {
  const { workspaceSlug, projectSlug, docId } = await params;
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

  const erd = await getErdForDocument(docId);
  const docLink = `/${workspaceSlug}/${projectSlug}/specs/${docId}`;
  const back = `/${workspaceSlug}/${projectSlug}/schema`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="min-w-0">
          <Link
            href={back}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            All schemas
          </Link>
          <p className="mt-0.5 truncate text-sm font-medium">
            {erd?.title ?? "Schema"}
          </p>
        </div>
        <Link
          href={docLink}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open document
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        {erd ? (
          <ErdPanel
            documentId={docId}
            title={erd.title}
            model={erd.model}
            dbml={erd.dbml}
          />
        ) : (
          <ErdPanel
            documentId={docId}
            title="Schema"
            model={{ tables: [], relations: [] }}
            dbml=""
          />
        )}
      </div>
    </div>
  );
}
