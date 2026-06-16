import "server-only";

import { prisma } from "@forgespecs/db";

import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
}

/** The current session user id, or null. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

/** Workspaces the current user is a member of (via any membership row). */
export async function listWorkspacesForCurrentUser(): Promise<
  WorkspaceSummary[]
> {
  const userId = await currentUserId();
  if (!userId) return [];

  const workspaces = await prisma.workspace.findMany({
    where: { memberships: { some: { userId } } },
    select: { id: true, slug: true, name: true },
    orderBy: { name: "asc" },
  });
  return workspaces;
}

/** Resolve a workspace by slug (only if the user is a member). */
export async function getWorkspaceBySlug(
  slug: string,
): Promise<WorkspaceSummary | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const workspace = await prisma.workspace.findFirst({
    where: { slug, memberships: { some: { userId } } },
    select: { id: true, slug: true, name: true },
  });
  return workspace;
}
