import { notFound } from "next/navigation";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { headers } from "next/headers";
import { hasApiKey } from "@forgespecs/ai";
import { GenerateArchitectureWizard } from "@/features/generate/generate-architecture-wizard";
import { EmptyState } from "@/components/empty-state";
import { Sparkles } from "lucide-react";

/**
 * "Generate Complete Architecture" wizard page (full-bleed segment, off the hot
 * editor path). Multi-step form (idea → requirements → constraints → tech-prefs)
 * that starts a resumable generation job and shows the doc tree materializing
 * live in the sidebar. RBAC-gated; graceful when AI is unprovisioned.
 */
export default async function GeneratePage({
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
          icon={Sparkles}
          title="You can't generate here"
          description="Generating an architecture creates documents — ask an Architect or Owner for access."
        />
      </div>
    );
  }

  if (!hasApiKey()) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <EmptyState
          icon={Sparkles}
          title="AI is not configured"
          description="Set OPENROUTER_API_KEY on the server to enable architecture generation."
        />
      </div>
    );
  }

  return (
    <GenerateArchitectureWizard
      workspaceId={workspace.id}
      projectId={project.id}
      workspaceSlug={workspace.slug}
      projectSlug={project.slug}
    />
  );
}
