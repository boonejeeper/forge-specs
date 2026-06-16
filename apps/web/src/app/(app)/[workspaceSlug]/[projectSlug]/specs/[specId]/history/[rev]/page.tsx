import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getWorkspaceBySlug } from "@/lib/data/workspaces";
import { getProjectBySlug } from "@/lib/data/projects";
import {
  getDocument,
  getDocumentVersionContent,
} from "@/lib/data/documents";
import { can } from "@/lib/auth/rbac";
import { diffDocuments } from "@forgespecs/core";
import { DiffView } from "@/features/versioning/diff-view";
import { RestoreButton } from "@/features/versioning/restore-button";

/**
 * Diff view (M8). Compares version `from` (query param; defaults to rev-1) → the
 * `[rev]` snapshot. The diff is computed ON DEMAND server-side by the pure core
 * engine and the renderable model is handed to the client `DiffView`. This is a
 * code-split segment so the diff renderer never loads on the editor hot path.
 *
 * Viewing requires `doc.read`; the Restore action requires `doc.edit` (enforced
 * both at render via `canRestore` and in the Server Action's `withPermission`).
 */
export default async function SpecDiffPage({
  params,
  searchParams,
}: {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
    specId: string;
    rev: string;
  }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { workspaceSlug, projectSlug, specId, rev } = await params;
  const { from } = await searchParams;

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
  const [canRead, canRestore] = await Promise.all([
    can(scope, "doc.read"),
    can(scope, "doc.edit"),
  ]);
  if (!canRead) notFound();

  const toNum = Number.parseInt(rev, 10);
  if (!Number.isFinite(toNum)) notFound();
  const fromNum = from ? Number.parseInt(from, 10) : toNum - 1;

  const [toVersion, fromVersion] = await Promise.all([
    getDocumentVersionContent(specId, toNum),
    fromNum >= 1 ? getDocumentVersionContent(specId, fromNum) : null,
  ]);
  if (!toVersion) notFound();

  const diff = diffDocuments(
    fromVersion?.contentJSON ?? [],
    toVersion.contentJSON,
  );

  const base = `/${workspaceSlug}/${projectSlug}/specs/${specId}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="min-w-0">
          <Link
            href={`${base}/history`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to history
          </Link>
          <p className="mt-0.5 truncate text-sm font-medium">
            Comparing{" "}
            <span className="font-mono">
              {fromVersion ? `v${fromVersion.versionNum}` : "∅"}
            </span>{" "}
            → <span className="font-mono">v{toVersion.versionNum}</span>
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DiffView
          diff={diff}
          toolbar={
            <RestoreButton
              documentId={specId}
              versionNum={toVersion.versionNum}
              scope={scope}
              base={base}
              canRestore={canRestore}
            />
          }
        />
      </div>
    </div>
  );
}
