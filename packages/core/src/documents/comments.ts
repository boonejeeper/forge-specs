/**
 * Comment thread data accessors + DTOs.
 *
 * Comment BODIES, threading (`parentId`), authorship and resolution are
 * queryable server facts and live in Postgres — this module reads them. The
 * comment ANCHOR (a Yjs relative position) is carried opaquely in `anchor` and
 * resolved to an absolute position client-side via `comment-anchor.ts`; the
 * server never decodes it.
 *
 * A "thread" is a root comment (`parentId === null`) plus its replies. We use
 * the root comment's `id` as the stable `commentThreadId` (matches the query key
 * factory) — no extra column needed.
 */
import { prisma, type Prisma, type PrismaClient } from "@forgespecs/db";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CommentDto {
  id: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  /** Opaque serialized Yjs anchor (resolved client-side). Null for replies. */
  anchor: unknown;
  blockId: string | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentThreadDto {
  /** Root comment id == commentThreadId. */
  id: string;
  root: CommentDto;
  replies: CommentDto[];
  anchor: unknown;
  blockId: string | null;
  resolved: boolean;
}

const COMMENT_SELECT = {
  id: true,
  parentId: true,
  authorId: true,
  author: { select: { name: true } },
  body: true,
  anchor: true,
  blockId: true,
  resolved: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toDto(r: {
  id: string;
  parentId: string | null;
  authorId: string | null;
  author: { name: string | null } | null;
  body: string;
  anchor: unknown;
  blockId: string | null;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CommentDto {
  return {
    id: r.id,
    parentId: r.parentId,
    authorId: r.authorId,
    authorName: r.author?.name ?? null,
    body: r.body,
    anchor: r.anchor ?? null,
    blockId: r.blockId,
    resolved: r.resolved,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Load all comment threads for a document, assembled root → replies. Replies are
 * sorted oldest-first (reading order); roots newest-first so fresh threads sit
 * on top of the sidebar.
 */
export async function listCommentThreads(
  documentId: string,
  db: Db = prisma,
): Promise<CommentThreadDto[]> {
  const rows = await db.comment.findMany({
    where: { documentId },
    orderBy: { createdAt: "asc" },
    select: COMMENT_SELECT,
  });

  const dtos = rows.map(toDto);
  const repliesByParent = new Map<string, CommentDto[]>();
  for (const c of dtos) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    }
  }

  const threads = dtos
    .filter((c) => c.parentId === null)
    .map<CommentThreadDto>((root) => ({
      id: root.id,
      root,
      replies: repliesByParent.get(root.id) ?? [],
      anchor: root.anchor,
      blockId: root.blockId,
      resolved: root.resolved,
    }));

  // Newest threads first.
  threads.sort(
    (a, b) =>
      new Date(b.root.createdAt).getTime() -
      new Date(a.root.createdAt).getTime(),
  );
  return threads;
}

/** Resolve the document id for a comment (used to derive scope in actions). */
export async function commentDocumentId(
  commentId: string,
  db: Db = prisma,
): Promise<string | null> {
  const c = await db.comment.findUnique({
    where: { id: commentId },
    select: { documentId: true },
  });
  return c?.documentId ?? null;
}
