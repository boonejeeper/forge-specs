import { notFound } from "next/navigation";
import { Activity } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { PrLinksPanel, type PrLink } from "@/components/document/pr-links-panel";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { listDocumentActivity } from "@/lib/data/activity";
import { listPullRequestLinks } from "@/lib/actions/pr-links";
import { can } from "@/lib/auth/rbac";

/** Per-document activity sub-view (create / rename / status / version + PR links). */
export default async function SpecActivityPage({
  params,
}: {
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

  const [items, prLinks, canEdit] = await Promise.all([
    listDocumentActivity(workspace.id, specId),
    listPullRequestLinks(specId),
    can(
      { kind: "project", workspaceId: workspace.id, projectId: project.id },
      "doc.edit",
    ),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PrLinksPanel
        workspaceId={workspace.id}
        projectId={project.id}
        documentId={specId}
        initialLinks={prLinks as PrLink[]}
        canEdit={canEdit}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Edits, status changes, and version snapshots for this spec will appear here."
        />
      ) : (
        <ActivityFeed items={items} workspaceSlug={workspaceSlug} />
      )}
    </div>
  );
}
