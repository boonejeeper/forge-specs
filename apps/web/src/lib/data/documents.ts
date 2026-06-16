import "server-only";

import {
  prisma,
  type DocumentStatus,
  type DocumentType,
} from "@forgespecs/db";

export interface DocumentTreeItem {
  id: string;
  slug: string;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
  order: number;
  updatedAt: string;
}

/**
 * Flat, ordered list of documents in a project. The client tree component
 * groups these by `type` and renders them in `DOC_TYPE_ORDER`. We keep the
 * server payload flat so reordering mutations can patch a single array.
 */
export async function getDocumentTree(
  projectId: string,
): Promise<DocumentTreeItem[]> {
  const docs = await prisma.document.findMany({
    where: { projectId },
    orderBy: [{ type: "asc" }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      status: true,
      frontmatter: true,
      updatedAt: true,
    },
  });

  return docs.map((d) => ({
    id: d.id,
    slug: d.slug,
    title: d.title,
    type: d.type,
    status: d.status,
    // Fractional sort order lives in frontmatter.order (documents have no
    // dedicated column; Block.order is the block-tree field). Defaults keep
    // existing docs stable until first reorder.
    order: readOrder(d.frontmatter),
    updatedAt: d.updatedAt.toISOString(),
  }));
}

function readOrder(frontmatter: unknown): number {
  if (
    frontmatter &&
    typeof frontmatter === "object" &&
    "order" in frontmatter &&
    typeof (frontmatter as { order: unknown }).order === "number"
  ) {
    return (frontmatter as { order: number }).order;
  }
  return 0;
}

export interface Frontmatter {
  owner?: string;
  version?: string;
  implementation_state?: string;
  order?: number;
  [key: string]: unknown;
}

export interface DocumentDetail {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
  frontmatter: Frontmatter;
  /** BlockNote document JSON (the body). `null` for never-edited docs. */
  contentJSON: unknown;
  currentVersion: number;
  authorName: string | null;
  updatedAt: string;
}

export async function getDocument(
  documentId: string,
): Promise<DocumentDetail | null> {
  const d = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      projectId: true,
      slug: true,
      title: true,
      type: true,
      status: true,
      frontmatter: true,
      contentJSON: true,
      currentVersion: true,
      updatedAt: true,
      author: { select: { name: true } },
    },
  });
  if (!d) return null;
  return {
    id: d.id,
    projectId: d.projectId,
    slug: d.slug,
    title: d.title,
    type: d.type,
    status: d.status,
    frontmatter: (d.frontmatter as Frontmatter) ?? {},
    contentJSON: d.contentJSON ?? null,
    currentVersion: d.currentVersion,
    authorName: d.author?.name ?? null,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export interface ProjectMember {
  id: string;
  name: string;
  email: string;
}

/**
 * Members of the project, for the editor's @user mention menu. Resolves both
 * workspace-level members and any project-level membership overrides.
 */
export async function getProjectMembers(
  workspaceId: string,
  projectId: string,
): Promise<ProjectMember[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      workspaceId,
      OR: [{ projectId: null }, { projectId }],
    },
    select: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
  const byId = new Map<string, ProjectMember>();
  for (const m of memberships) {
    if (m.user) {
      byId.set(m.user.id, {
        id: m.user.id,
        name: m.user.name ?? m.user.email,
        email: m.user.email,
      });
    }
  }
  return [...byId.values()];
}

/** Resolve a document by project + slug (deep-link friendly). */
export async function getDocumentBySlug(
  projectId: string,
  slug: string,
): Promise<DocumentDetail | null> {
  const d = await prisma.document.findFirst({
    where: { projectId, slug },
    select: { id: true },
  });
  return d ? getDocument(d.id) : null;
}

export interface DocumentVersionSummary {
  id: string;
  versionNum: number;
  summary: string | null;
  authorName: string | null;
  createdAt: string;
}

export async function listDocumentVersions(
  documentId: string,
): Promise<DocumentVersionSummary[]> {
  const versions = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { versionNum: "desc" },
    select: {
      id: true,
      versionNum: true,
      summary: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });
  return versions.map((v) => ({
    id: v.id,
    versionNum: v.versionNum,
    summary: v.summary,
    authorName: v.author?.name ?? null,
    createdAt: v.createdAt.toISOString(),
  }));
}

export interface DocumentVersionContent {
  versionNum: number;
  summary: string | null;
  authorName: string | null;
  createdAt: string;
  /** BlockNote document JSON snapshot. */
  contentJSON: unknown;
}

/** Load a single version's full snapshot content (for diffing/preview). */
export async function getDocumentVersionContent(
  documentId: string,
  versionNum: number,
): Promise<DocumentVersionContent | null> {
  const v = await prisma.documentVersion.findUnique({
    where: { documentId_versionNum: { documentId, versionNum } },
    select: {
      versionNum: true,
      summary: true,
      createdAt: true,
      contentJSON: true,
      author: { select: { name: true } },
    },
  });
  if (!v) return null;
  return {
    versionNum: v.versionNum,
    summary: v.summary,
    authorName: v.author?.name ?? null,
    createdAt: v.createdAt.toISOString(),
    contentJSON: v.contentJSON ?? [],
  };
}
