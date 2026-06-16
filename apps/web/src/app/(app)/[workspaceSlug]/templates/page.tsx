import { notFound } from "next/navigation";

import { templateGallery } from "@forgespecs/core/templates";

import { PageHeader } from "@/components/page-header";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { listProjects } from "@/lib/data/projects";
import { TemplatesGallery } from "@/features/templates/templates-gallery";

/**
 * Templates gallery (M10): lists the built-in starter templates (SaaS,
 * Marketplace, Agent Platform, LMS, E-Commerce, Kubernetes Platform,
 * Event-Driven, Microservices, Monolith). Each is a seed graph of documents +
 * dependency edges; "Apply template" creates them in a chosen project via the
 * `doc.create`-guarded applyTemplate action.
 */
export default async function WorkspaceTemplatesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const [templates, projects] = await Promise.all([
    Promise.resolve(templateGallery()),
    listProjects(workspace.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Templates"
        description="Start from a battle-tested architecture. Each template seeds a graph of linked specs you can refine and hand to coding agents."
      />
      <TemplatesGallery
        templates={templates}
        workspaceId={workspace.id}
        workspaceSlug={workspaceSlug}
        projects={projects
          .filter((p) => !p.archived)
          .map((p) => ({ id: p.id, name: p.name, slug: p.slug }))}
      />
    </div>
  );
}
