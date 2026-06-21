import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { getIngestServerInfo } from "@/lib/actions/ingest";
import { IngestFlow } from "@/features/ingest/ingest-flow";
import { EmptyState } from "@/components/empty-state";
import { Boxes } from "lucide-react";

/**
 * Repo ingest page. Server component does auth + RBAC + server-info preflight,
 * then renders the client flow. RBAC: `doc.create` AND `ai.invoke` at project
 * scope, same as the architecture wizard (the ingest job creates documents).
 */
export default async function IngestPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();
  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) notFound();

  const scope = {
    kind: "project" as const,
    workspaceId: workspace.id,
    projectId: project.id,
  };
  const allowed =
    (await can(scope, "doc.create")) && (await can(scope, "ai.invoke"));
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <EmptyState
          icon={Boxes}
          title="You can't ingest here"
          description="Repo ingest creates documents — ask an Architect or Owner for access."
        />
      </div>
    );
  }

  const serverInfo = await getIngestServerInfo();

  return (
    <IngestFlow
      workspaceId={workspace.id}
      projectId={project.id}
      workspaceSlug={workspace.slug}
      projectSlug={project.slug}
      serverInfo={serverInfo}
    />
  );
}
