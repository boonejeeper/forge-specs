import { notFound } from "next/navigation";

import { getDocument, getProjectMembers } from "@/lib/data/documents";
import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import {
  getCommentThreads,
  getReviews,
  getSuggestions,
} from "@/lib/data/collaboration";
import { can } from "@/lib/auth/rbac";
import { Hydrate } from "@/lib/query/hydrate";
import { queryKeys } from "@/lib/query/keys";
import { FrontmatterEditor } from "@/components/document/frontmatter-editor";
import { VersionControls } from "@/components/document/version-controls";
import { SpecWorkspace } from "@/components/document/spec-workspace";
import { AgentModeMenu } from "@/features/generate/agent-mode-menu";
import type { CollaborationCapabilities } from "@/features/collaboration/collaboration-panel";
import type { MentionTarget } from "@/features/editor/ForgeEditor";

/**
 * Document view (M5). The metadata/frontmatter header sits above the editor +
 * collaboration panel (comments / suggestions / reviews). RBAC capabilities are
 * resolved server-side and passed down so each surface paints the right
 * affordances; the mutating Server Actions enforce the same permissions as
 * defense-in-depth. The collaboration query caches are RSC-seeded for instant
 * paint, then kept live via TanStack Query (+ the SSE inbox stream).
 */
export default async function SpecPage({
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

  const [editable, canGenerate, caps] = await Promise.all([
    can(scope, "doc.edit"),
    can(scope, "doc.create"),
    resolveCaps(scope),
  ]);

  const members = await getProjectMembers(workspace.id, project.id);
  const mentionTargets: MentionTarget[] = members.map((m) => ({
    id: m.id,
    label: m.name,
    kind: "user",
  }));

  const link = `/${workspaceSlug}/${projectSlug}/specs/${specId}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-6 pt-6">
        <FrontmatterEditor
          documentId={doc.id}
          status={doc.status}
          frontmatter={doc.frontmatter}
          editable={editable}
        />
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Version {doc.currentVersion}
            {doc.authorName ? ` · created by ${doc.authorName}` : ""}
          </p>
          <div className="flex items-center gap-2">
            {canGenerate ? (
              <AgentModeMenu
                documentId={doc.id}
                workspaceId={workspace.id}
                projectId={project.id}
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
              />
            ) : null}
            {editable ? (
              <VersionControls
                documentId={doc.id}
                historyHref={`${link}/history`}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Hydrate
          prefetch={async (qc) => {
            await Promise.all([
              qc.prefetchQuery({
                queryKey: queryKeys.comments.forDocument(doc.id),
                queryFn: () => getCommentThreads(doc.id),
              }),
              qc.prefetchQuery({
                queryKey: queryKeys.suggestions.forDocument(doc.id),
                queryFn: () => getSuggestions(doc.id),
              }),
              qc.prefetchQuery({
                queryKey: queryKeys.reviews.forDocument(doc.id),
                queryFn: () => getReviews(doc.id),
              }),
            ]);
          }}
        >
          <SpecWorkspace
            documentId={doc.id}
            docTitle={doc.title}
            initialContent={doc.contentJSON}
            editable={editable}
            mentionTargets={mentionTargets}
            scope={scope}
            link={link}
            caps={caps}
          />
        </Hydrate>
      </div>
    </div>
  );
}

async function resolveCaps(
  scope: { kind: "project"; workspaceId: string; projectId: string },
): Promise<CollaborationCapabilities> {
  const [comment, commentResolve, suggest, suggestResolve, review] =
    await Promise.all([
      can(scope, "comment.create"),
      can(scope, "comment.resolve"),
      can(scope, "suggestion.create"),
      can(scope, "suggestion.resolve"),
      can(scope, "review.submit"),
    ]);
  return { comment, commentResolve, suggest, suggestResolve, review };
}
