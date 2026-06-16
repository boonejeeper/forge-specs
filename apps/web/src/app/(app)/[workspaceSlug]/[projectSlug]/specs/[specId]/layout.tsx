import { notFound } from "next/navigation";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getDocument } from "@/lib/data/documents";
import { SpecTabs } from "@/components/document/spec-tabs";
import { StatusBadge } from "@/components/document/status-badge";
import { docTypeLabel } from "@forgespecs/core";

/**
 * Spec view shell: the document header (type, title, status) plus deep-linkable
 * sub-view tabs (Document / History / Graph / Activity). Each tab is a nested
 * route segment so it is code-split and independently navigable.
 */
export default async function SpecLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  const base = `/${workspaceSlug}/${projectSlug}/specs/${specId}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-6 pt-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{docTypeLabel(doc.type)}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>
          <StatusBadge status={doc.status} />
        </div>
        <SpecTabs base={base} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
