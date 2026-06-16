import "server-only";

import { prisma } from "@forgespecs/db";

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  archived: boolean;
  documentCount: number;
}

function toSummary(p: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  _count: { documents: number };
}): ProjectSummary {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    archived: p.archivedAt !== null,
    documentCount: p._count.documents,
  };
}

const PROJECT_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  archivedAt: true,
  _count: { select: { documents: true } },
} as const;

/** Projects in a workspace (active first, then archived). */
export async function listProjects(
  workspaceId: string,
): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: PROJECT_SELECT,
  });
  return projects.map(toSummary);
}

export async function getProjectBySlug(
  workspaceId: string,
  slug: string,
): Promise<ProjectSummary | null> {
  const p = await prisma.project.findFirst({
    where: { workspaceId, slug },
    select: PROJECT_SELECT,
  });
  return p ? toSummary(p) : null;
}
