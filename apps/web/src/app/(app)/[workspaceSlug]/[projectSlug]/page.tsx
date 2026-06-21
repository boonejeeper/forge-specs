import { notFound } from "next/navigation";
import { FileText, Boxes } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { docTypeLabel } from "@forgespecs/core";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getDocumentTree } from "@/lib/data/documents";
import { computeOnboardingState } from "@/lib/data/onboarding";
import { StatusBadge } from "@/components/document/status-badge";
import { NextStepsCard } from "@/components/onboarding/next-steps-card";
import Link from "next/link";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const { workspaceSlug, projectSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();
  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();

  const docs = await getDocumentTree(project.id);
  const recent = [...docs]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  const onboarding = await computeOnboardingState({
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    projectId: project.id,
    projectSlug: project.slug,
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <PageHeader
        title={project.name}
        description={
          project.description ??
          "The spec repository for this project. Pick a document from the tree, or create a new one."
        }
      />

      <NextStepsCard
        state={onboarding}
        projectId={project.id}
        scopeLabel={project.name}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Documents", value: docs.length },
          {
            label: "In review",
            value: docs.filter((d) => d.status === "REVIEW").length,
          },
          {
            label: "Approved",
            value: docs.filter((d) => d.status === "APPROVED").length,
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border p-4">
            <div className="text-sm text-muted-foreground">{stat.label}</div>
            <div className="mt-1 text-2xl font-semibold">{stat.value}</div>
          </div>
        ))}
      </div>

      {recent.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Use the + in the spec tree to create your first Vision, PRD, or RFC — or seed everything from an existing repo."
          />
          <Link
            href={`/${workspace.slug}/${project.slug}/ingest`}
            className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
          >
            <Boxes className="size-4 text-primary" />
            <span className="font-medium">Import from a repo</span>
            <span className="text-muted-foreground">
              Point at a folder or GitHub repo → clean canonical doc set.
            </span>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Recently updated</h2>
          <ul className="divide-y rounded-lg border">
            {recent.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/${workspace.slug}/${project.slug}/specs/${d.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/50"
                >
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {docTypeLabel(d.type)}
                  </span>
                  <StatusBadge status={d.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
