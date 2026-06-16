import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { EmptyState } from "@/components/empty-state";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { listWorkspaceAuditLog } from "@/lib/data/activity";
import { can } from "@/lib/auth/rbac";

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  // Audit log is restricted to workspace managers/owners (workspace.manage).
  const canViewAudit = await can(
    { kind: "workspace", workspaceId: workspace.id },
    "workspace.manage",
  );
  const auditItems = canViewAudit
    ? await listWorkspaceAuditLog(workspace.id)
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <PageHeader
        title="Settings"
        description={`Workspace, members, and preferences for ${workspace.name}.`}
      />
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Appearance</div>
          <div className="text-sm text-muted-foreground">
            Toggle between light and dark.
          </div>
        </div>
        <ThemeToggle />
      </div>
      <div className="rounded-lg border p-4">
        <div className="text-sm font-medium">Workspace slug</div>
        <div className="mt-1 font-mono text-sm text-muted-foreground">
          {workspace.slug}
        </div>
      </div>

      {canViewAudit ? (
        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Audit log</h2>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Security-relevant actions: role changes, status approvals, restores,
            template applies, SSO logins, and pull-request links.
          </p>
          {auditItems.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No audit events yet"
              description="Security-relevant actions will appear here as they happen."
            />
          ) : (
            <ActivityFeed items={auditItems} workspaceSlug={workspace.slug} />
          )}
        </section>
      ) : null}
    </div>
  );
}
