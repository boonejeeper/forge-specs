"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@forgespecs/db";
import {
  withPermission,
  slugify,
  uniqueSlug,
  type Scope,
} from "@forgespecs/core";

import "@/lib/auth/rbac"; // installs the RBAC provider on import

export interface ProjectResult {
  id: string;
  slug: string;
  name: string;
}

const workspaceScope = (workspaceId: string): Scope => ({
  kind: "workspace",
  workspaceId,
});

const projectScope = (workspaceId: string, projectId: string): Scope => ({
  kind: "project",
  workspaceId,
  projectId,
});

// NOTE: A "use server" module may only export async functions, so each Server
// Action is a thin async wrapper that delegates to a (non-exported)
// withPermission-guarded implementation. The guard is still the chokepoint —
// the wrapper just satisfies the compiler's export contract.

const _createProject = withPermission(
  (input: { workspaceId: string; name: string }) =>
    workspaceScope(input.workspaceId),
  "project.create",
  async (actor, input): Promise<ProjectResult> => {
    const name = input.name.trim();
    if (!name) throw new Error("Project name is required.");

    const siblings = await prisma.project.findMany({
      where: { workspaceId: input.workspaceId },
      select: { slug: true },
    });
    const slug = uniqueSlug(
      slugify(name),
      siblings.map((p) => p.slug),
    );

    const project = await prisma.project.create({
      data: {
        workspaceId: input.workspaceId,
        name,
        slug,
        createdById: actor.userId,
      },
      select: { id: true, slug: true, name: true },
    });

    revalidatePath("/", "layout");
    return project;
  },
);

const _renameProject = withPermission(
  (input: { workspaceId: string; projectId: string; name: string }) =>
    projectScope(input.workspaceId, input.projectId),
  "project.manage",
  async (_actor, input): Promise<ProjectResult> => {
    const name = input.name.trim();
    if (!name) throw new Error("Project name is required.");

    const project = await prisma.project.update({
      where: { id: input.projectId },
      data: { name },
      select: { id: true, slug: true, name: true },
    });

    revalidatePath("/", "layout");
    return project;
  },
);

const _setProjectArchived = withPermission(
  (input: { workspaceId: string; projectId: string; archived: boolean }) =>
    projectScope(input.workspaceId, input.projectId),
  "project.manage",
  async (_actor, input): Promise<ProjectResult> => {
    const project = await prisma.project.update({
      where: { id: input.projectId },
      data: { archivedAt: input.archived ? new Date() : null },
      select: { id: true, slug: true, name: true },
    });

    revalidatePath("/", "layout");
    return project;
  },
);

/** Create a project in a workspace. Requires `project.create`. */
export async function createProject(input: {
  workspaceId: string;
  name: string;
}): Promise<ProjectResult> {
  return _createProject(input);
}

/** Rename a project. Requires `project.manage`. */
export async function renameProject(input: {
  workspaceId: string;
  projectId: string;
  name: string;
}): Promise<ProjectResult> {
  return _renameProject(input);
}

/** Archive or unarchive a project. Requires `project.manage`. */
export async function setProjectArchived(input: {
  workspaceId: string;
  projectId: string;
  archived: boolean;
}): Promise<ProjectResult> {
  return _setProjectArchived(input);
}
