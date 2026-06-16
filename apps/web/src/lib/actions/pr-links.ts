"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@forgespecs/db";
import { withPermission, logActivity, parsePrUrl, type Scope } from "@forgespecs/core";

import "@/lib/auth/rbac"; // installs the RBAC provider on import

/**
 * GitHub PR linkage Server Actions (M11), OPTIONAL.
 *
 * Link a Document (spec / task plan) to a GitHub pull request by pasting its URL.
 * The /api/webhooks/github route then reflects the PR's status onto the link.
 * Guarded by `doc.edit` at the project scope; writes a PR_LINKED audit event.
 */

const projectScope = (workspaceId: string, projectId: string): Scope => ({
  kind: "project",
  workspaceId,
  projectId,
});

export interface PrLinkResult {
  id: string;
  url: string;
  repoOwner: string;
  repoName: string;
  number: number;
}

const _linkPullRequest = withPermission(
  (input: {
    workspaceId: string;
    projectId: string;
    documentId: string;
    url: string;
  }) => projectScope(input.workspaceId, input.projectId),
  "doc.edit",
  async (actor, input): Promise<PrLinkResult> => {
    const ref = parsePrUrl(input.url);
    if (!ref) {
      throw new Error(
        "Enter a valid GitHub PR URL, e.g. https://github.com/owner/repo/pull/123.",
      );
    }

    // Ensure the document belongs to the authorized project.
    const doc = await prisma.document.findUnique({
      where: { id: input.documentId },
      select: { projectId: true },
    });
    if (!doc || doc.projectId !== input.projectId) {
      throw new Error("Document not found in this project.");
    }

    const link = await prisma.$transaction(async (tx) => {
      const created = await tx.pullRequestLink.upsert({
        where: {
          documentId_repoOwner_repoName_number: {
            documentId: input.documentId,
            repoOwner: ref.owner,
            repoName: ref.repo,
            number: ref.number,
          },
        },
        create: {
          documentId: input.documentId,
          createdById: actor.userId,
          repoOwner: ref.owner,
          repoName: ref.repo,
          number: ref.number,
          url: input.url.trim(),
        },
        update: { url: input.url.trim() },
        select: {
          id: true,
          url: true,
          repoOwner: true,
          repoName: true,
          number: true,
        },
      });
      await logActivity(
        {
          workspaceId: input.workspaceId,
          actorId: actor.userId,
          type: "PR_LINKED",
          entityType: "document",
          entityId: input.documentId,
          data: {
            number: ref.number,
            repo: `${ref.owner}/${ref.repo}`,
            url: input.url.trim(),
          } as Prisma.InputJsonValue,
        },
        tx,
      );
      return created;
    });

    revalidatePath("/", "layout");
    return link;
  },
);

/** Link a document to a GitHub PR. Requires `doc.edit`. */
export async function linkPullRequest(input: {
  workspaceId: string;
  projectId: string;
  documentId: string;
  url: string;
}): Promise<PrLinkResult> {
  return _linkPullRequest(input);
}

const _unlinkPullRequest = withPermission(
  (input: { workspaceId: string; projectId: string; linkId: string }) =>
    projectScope(input.workspaceId, input.projectId),
  "doc.edit",
  async (_actor, input): Promise<{ removed: true }> => {
    await prisma.pullRequestLink.delete({ where: { id: input.linkId } });
    revalidatePath("/", "layout");
    return { removed: true };
  },
);

/** Remove a PR link. Requires `doc.edit`. */
export async function unlinkPullRequest(input: {
  workspaceId: string;
  projectId: string;
  linkId: string;
}): Promise<{ removed: true }> {
  return _unlinkPullRequest(input);
}

/** List PR links for a document (read path). */
export async function listPullRequestLinks(documentId: string) {
  return prisma.pullRequestLink.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      repoOwner: true,
      repoName: true,
      number: true,
      title: true,
      state: true,
      merged: true,
    },
  });
}
