"use server";

import { headers } from "next/headers";

import {
  getDocumentTree,
  type DocumentTreeItem,
} from "@/lib/data/documents";
import { listProjects, type ProjectSummary } from "@/lib/data/projects";
import {
  getCommentThreads,
  getReviews,
  getSuggestions,
  getInbox,
  type CommentThreadDto,
  type ReviewDto,
  type SuggestionDto,
  type InboxItem,
} from "@/lib/data/collaboration";
import { auth } from "@/lib/auth/auth";

import "@/lib/auth/rbac";

/**
 * Thin read Server Actions used as TanStack Query `queryFn`s on the client.
 * RSC seeds the cache for the initial paint; these let client-side
 * invalidations refetch the same shapes without a dedicated API route.
 *
 * They reuse the same server-only data accessors as the RSC prefetch, so the
 * hydrated and refetched payloads are identical.
 */

export async function fetchProjects(
  workspaceId: string,
): Promise<ProjectSummary[]> {
  return listProjects(workspaceId);
}

export async function fetchDocumentTree(
  projectId: string,
): Promise<DocumentTreeItem[]> {
  return getDocumentTree(projectId);
}

export async function fetchCommentThreads(
  documentId: string,
): Promise<CommentThreadDto[]> {
  return getCommentThreads(documentId);
}

export async function fetchSuggestions(
  documentId: string,
): Promise<SuggestionDto[]> {
  return getSuggestions(documentId);
}

export async function fetchReviews(documentId: string): Promise<ReviewDto[]> {
  return getReviews(documentId);
}

/** The current user's notification inbox (newest first). */
export async function fetchInbox(
  opts: { unreadOnly?: boolean } = {},
): Promise<InboxItem[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) return [];
  return getInbox(userId, opts);
}
