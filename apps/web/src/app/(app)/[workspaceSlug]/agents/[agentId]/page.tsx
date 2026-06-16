import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, FileText } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getAgentView, type AgentDocRef } from "@/lib/data/agents";
import { AgentExportButtons } from "@/features/agents/export-buttons";

/**
 * Agent detail (M10): the per-agent portal. Shows the agent's assigned RFCs,
 * related APIs and schemas, and the acceptance criteria pulled from the assigned
 * docs + their dependency closure — then offers the export bundle (MD/JSON/YAML)
 * an autonomous coding agent consumes. RBAC scoping lives in getAgentView.
 */
export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; agentId: string }>;
}) {
  const { workspaceSlug, agentId } = await params;
  const agentName = decodeURIComponent(agentId);

  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const view = await getAgentView(workspace.id, agentName);
  if (!view) notFound();

  const safeName = agentName.replace(/[^a-zA-Z0-9_-]+/g, "-");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Bot className="size-6" /> {agentName}
          </span>
        }
        description="Assigned specifications and the export bundle for autonomous execution."
      />

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <div>
          <h2 className="text-sm font-semibold">Export bundle</h2>
          <p className="text-sm text-muted-foreground">
            The assigned docs plus their dependency closure — with frontmatter,
            acceptance criteria, and extracted OpenAPI / DBML+SQL — in the format
            your coding agent prefers.
          </p>
        </div>
        <AgentExportButtons
          agentName={agentName}
          workspaceId={workspace.id}
          baseFilename={`agent-${safeName}`}
        />
      </section>

      <DocSection title="Assigned work" docs={view.assigned} workspaceSlug={workspaceSlug} />
      <DocSection title="Related RFCs" docs={view.rfcs} workspaceSlug={workspaceSlug} />
      <DocSection title="Related APIs" docs={view.apis} workspaceSlug={workspaceSlug} />
      <DocSection title="Related schemas" docs={view.schemas} workspaceSlug={workspaceSlug} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Acceptance criteria</h2>
        {view.acceptance.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No acceptance criteria found in the assigned docs or their dependencies.
          </p>
        ) : (
          <div className="space-y-4">
            {view.acceptance.map((group) => (
              <div key={group.documentId} className="rounded-lg border p-4">
                <h3 className="mb-2 text-sm font-medium">{group.documentTitle}</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {group.criteria.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DocSection({
  title,
  docs,
  workspaceSlug,
}: {
  title: string;
  docs: AgentDocRef[];
  workspaceSlug: string;
}) {
  if (docs.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="divide-y rounded-lg border">
        {docs.map((d) => (
          <li key={d.id}>
            <Link
              href={`/${workspaceSlug}/${d.projectSlug}/specs/${d.slug}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-accent"
            >
              <span className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                {d.title}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5">{d.type}</span>
                <span>{d.status}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
