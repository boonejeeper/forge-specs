"use server";

import { revalidatePath } from "next/cache";
import { prisma, Role } from "@forgespecs/db";
import { slugify, uniqueSlug } from "@forgespecs/core";

import "@/lib/auth/rbac"; // installs the RBAC provider on import
import { currentUserId } from "@/lib/data/workspaces";

export interface CreateWorkspaceResult {
  id: string;
  slug: string;
  name: string;
}

/**
 * Create a workspace and make the creator its OWNER. There is no parent scope
 * to authorize against (anyone signed in may create a workspace), so this is
 * guarded by an authenticated-session check rather than `withPermission`.
 */
export async function createWorkspace(
  name: string,
): Promise<CreateWorkspaceResult> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Authentication required.");

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Workspace name is required.");

  const base = slugify(trimmed);
  const existing = await prisma.workspace.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const slug = uniqueSlug(
    base,
    existing.map((w) => w.slug),
  );

  const workspace = await prisma.workspace.create({
    data: {
      name: trimmed,
      slug,
      memberships: {
        create: { userId, role: Role.OWNER },
      },
    },
    select: { id: true, slug: true, name: true },
  });

  revalidatePath("/", "layout");
  return workspace;
}
