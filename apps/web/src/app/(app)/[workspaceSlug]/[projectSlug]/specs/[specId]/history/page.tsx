import { notFound } from "next/navigation";
import { History } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getDocument, listDocumentVersions } from "@/lib/data/documents";
import { can } from "@/lib/auth/rbac";
import { VersionHistory } from "@/features/versioning/version-history";

/**
 * Version history sub-view (M8) — revision list with select-two-to-compare.
 * Viewing requires `doc.read` (the (app) layout already gates membership). The
 * diff/restore-heavy UI lives on the `[rev]` child segment, code-split off the
 * editor hot path.
 */
export default async function SpecHistoryPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string; specId: string }>;
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

  const versions = await listDocumentVersions(specId);
  const base = `/${workspaceSlug}/${projectSlug}/specs/${specId}`;

  if (versions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <EmptyState
          icon={History}
          title="No snapshots yet"
          description="Use “Snapshot version” on the Document tab to checkpoint this spec, then compare and restore revisions here."
        />
      </div>
    );
  }

  return <VersionHistory versions={versions} base={base} />;
}
