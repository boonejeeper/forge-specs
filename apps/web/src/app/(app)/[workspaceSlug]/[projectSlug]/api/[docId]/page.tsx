import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import { getOpenApiForDocument } from "@/lib/data/visual-docs";
import { can } from "@/lib/auth/rbac";
import { OpenApiPanel } from "@/features/graph/openapi-panel";

/**
 * Per-document OpenAPI explorer (M9). Extracts the OpenAPI spec from the
 * API_SPEC document's code blocks and renders it with Scalar. Full-bleed; the
 * Scalar bundle is code-split (dynamic ssr:false).
 */
export default async function ApiDocPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string; docId: string }>;
}) {
  const { workspaceSlug, projectSlug, docId } = await params;
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) notFound();
  const project = await getProjectBySlug(workspace.id, projectSlug);
  if (!project) notFound();
  const scope = {
    kind: "project" as const,
    workspaceId: workspace.id,
    projectId: project.id,
  };
  if (!(await can(scope, "doc.read"))) notFound();

  const api = await getOpenApiForDocument(docId);
  const docLink = `/${workspaceSlug}/${projectSlug}/specs/${docId}`;
  const back = `/${workspaceSlug}/${projectSlug}/api`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="min-w-0">
          <Link
            href={back}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            All APIs
          </Link>
          <p className="mt-0.5 truncate text-sm font-medium">
            {api?.title ?? "API specification"}
          </p>
        </div>
        <Link
          href={docLink}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open document
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <OpenApiPanel source={api?.source ?? null} />
      </div>
    </div>
  );
}
