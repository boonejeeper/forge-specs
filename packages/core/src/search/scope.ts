import type { PrismaClient } from "@forgespecs/db";

/**
 * Resolve the set of document ids a user is allowed to read, narrowed to an
 * optional workspace / project scope. This is the RBAC gate every search query
 * filters through: full-text and semantic builders both take an explicit
 * `documentId` allow-list so no row outside the user's membership can ever rank.
 *
 * Read access derives from membership the same way the RBAC chokepoint does:
 *  - a workspace-level membership grants read on every project in it, and
 *  - a project-level membership grants read on that project,
 * unless a more-specific project membership downgrades to VIEWER (VIEWER still
 * has `doc.read`, so for *read* scoping any membership row suffices). Because
 * every domain role in ROLE_CAPABILITIES holds `doc.read`, the allow-list is
 * simply "documents in projects the user is a member of (directly or via the
 * workspace)".
 *
 * Returns a bounded list of ids; callers pass it straight into the parameterized
 * search queries. An empty array means "no readable docs" → search returns [].
 */
export interface ReadableDocsFilter {
  userId: string;
  /** Constrain to a single workspace (optional). */
  workspaceId?: string;
  /** Constrain to a single project (optional). */
  projectId?: string;
  /** Safety cap on the candidate set. Default 5000. */
  limit?: number;
}

export async function readableDocumentIds(
  prisma: PrismaClient,
  filter: ReadableDocsFilter,
): Promise<string[]> {
  const { userId, workspaceId, projectId, limit = 5000 } = filter;

  // Projects the user can see: those whose workspace has a membership for the
  // user, OR that have a direct project-level membership for the user.
  const docs = await prisma.document.findMany({
    where: {
      project: {
        ...(projectId ? { id: projectId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        OR: [
          // Workspace-level membership (projectId null) covers all its projects.
          {
            workspace: {
              memberships: { some: { userId, projectId: null } },
            },
          },
          // Direct project-level membership.
          { memberships: { some: { userId } } },
        ],
      },
    },
    select: { id: true },
    take: limit,
  });

  return docs.map((d) => d.id);
}
