import { notFound } from "next/navigation";
import { Activity } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { listWorkspaceActivity } from "@/lib/data/activity";

/** Workspace-wide activity feed. */
export default async function WorkspaceActivityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const items = await listWorkspaceActivity(workspace.id);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PageHeader
        title="Activity"
        description="Document, status, and version events across the workspace."
      />
      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Create and edit specs to populate the feed."
        />
      ) : (
        <ActivityFeed items={items} workspaceSlug={workspaceSlug} />
      )}
    </div>
  );
}
