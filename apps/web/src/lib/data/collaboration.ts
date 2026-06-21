import "server-only";

import { prisma, type SuggestionStatus } from "@forgespecs/db";
import {
  listCommentThreads,
  listReviews,
  summarizeSuggestion,
  type CommentThreadDto,
  type ReviewDto,
  type SuggestionSummary,
} from "@forgespecs/core";

/**
 * Server-only data accessors for the M5 collaboration surfaces (comments,
 * suggestions, reviews). RSC layouts use these to seed the Query cache; the
 * matching read Server Actions (reads.ts) reuse them so hydrated and refetched
 * payloads are identical.
 */

export type { CommentThreadDto, ReviewDto } from "@forgespecs/core";

/** Comment threads for a document (root + replies, newest thread first). */
export async function getCommentThreads(
  documentId: string,
): Promise<CommentThreadDto[]> {
  return listCommentThreads(documentId);
}

/** Reviews for a document (with current-version flagging). */
export async function getReviews(documentId: string): Promise<ReviewDto[]> {
  return listReviews(documentId);
}

/**
 * Has ANY document in this project ever been reviewed? Cheap existence check
 * for the onboarding helper — single Prisma count with an early-exit limit.
 */
export async function hasAnyReview(projectId: string): Promise<boolean> {
  const row = await prisma.review.findFirst({
    where: { document: { projectId } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Has any document in this project ever been moved to APPROVED status? Used
 * by the Next Steps card to check off the "first approval" milestone.
 */
export async function hasAnyApprovedDoc(projectId: string): Promise<boolean> {
  const row = await prisma.document.findFirst({
    where: { projectId, status: "APPROVED" },
    select: { id: true },
  });
  return row !== null;
}

export interface SuggestionDto {
  id: string;
  status: SuggestionStatus;
  rationale: string | null;
  authorId: string | null;
  authorName: string | null;
  /** The jsondiffpatch delta (opaque to the client until preview). */
  patch: unknown;
  /** Block-level change counts for the list header. */
  summary: SuggestionSummary;
  createdAt: string;
  updatedAt: string;
}

/** Suggestions for a document, newest first, with a change summary. */
export async function getSuggestions(
  documentId: string,
): Promise<SuggestionDto[]> {
  const rows = await prisma.suggestion.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      rationale: true,
      authorId: true,
      author: { select: { name: true } },
      patch: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    rationale: r.rationale,
    authorId: r.authorId,
    authorName: r.author?.name ?? null,
    patch: r.patch,
    summary: summarizeSuggestion(r.patch),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/** A recipient's notification inbox (newest first). */
export async function getInbox(
  recipientId: string,
  opts: { unreadOnly?: boolean } = {},
): Promise<InboxItem[]> {
  const rows = await prisma.notification.findMany({
    where: {
      recipientId,
      ...(opts.unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      read: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.read,
    createdAt: r.createdAt.toISOString(),
  }));
}
