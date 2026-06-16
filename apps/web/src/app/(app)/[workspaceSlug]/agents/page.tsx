import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { listAgentsForWorkspace } from "@/lib/data/agents";

/**
 * Agent portal index (M10): one card per AI agent mentioned across the
 * workspace's readable docs (derived from isAgent Mention.agentName — the same
 * rows the M7 @agent-trigger consumes). Each agent links to its detail view with
 * assigned work + export bundle.
 */
export default async function AgentsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();

  const agents = await listAgentsForWorkspace(workspace.id);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <PageHeader
        title="Agents"
        description="Per-agent views of assigned RFCs, APIs, schemas and acceptance criteria — plus an export bundle an autonomous coding agent can consume."
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Mention an agent in a document or comment (@agent) to assign it work. It will appear here with an exportable spec bundle."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link
              key={agent.name}
              href={`/${workspaceSlug}/agents/${encodeURIComponent(agent.name)}`}
              className="flex flex-col rounded-lg border bg-card p-5 transition-colors hover:border-foreground/20"
            >
              <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted">
                <Bot className="size-5 text-foreground" />
              </div>
              <h3 className="text-base font-semibold">{agent.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {agent.assignedCount} assigned document
                {agent.assignedCount === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
