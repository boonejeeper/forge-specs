"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Scope } from "@forgespecs/core";
import type { ReviewDecision } from "@forgespecs/db";

import { queryKeys } from "@/lib/query/keys";
import {
  fetchCommentThreads,
  fetchReviews,
  fetchSuggestions,
} from "@/lib/actions/reads";
import {
  createComment,
  resolveComment,
  deleteComment,
} from "@/lib/actions/comments";
import {
  createSuggestion,
  resolveSuggestion,
} from "@/lib/actions/suggestions";
import { submitReview, requestReview } from "@/lib/actions/reviews";
import type { CommentThreadDto, ReviewDto } from "@/lib/data/collaboration";
import type { SuggestionDto } from "@/lib/data/collaboration";

/**
 * TanStack Query hooks for the M5 collaboration surfaces. Reads use the same
 * server-action accessors as the RSC seed; mutations invalidate the precise keys
 * from the query-key factory so the panel stays in sync (and the SSE stream
 * drives the inbox separately).
 */

export function useCommentThreads(documentId: string) {
  return useQuery({
    queryKey: queryKeys.comments.forDocument(documentId),
    queryFn: () => fetchCommentThreads(documentId),
  });
}

export function useSuggestions(documentId: string) {
  return useQuery({
    queryKey: queryKeys.suggestions.forDocument(documentId),
    queryFn: () => fetchSuggestions(documentId),
  });
}

export function useReviews(documentId: string) {
  return useQuery({
    queryKey: queryKeys.reviews.forDocument(documentId),
    queryFn: () => fetchReviews(documentId),
  });
}

export interface DocContext {
  documentId: string;
  scope: Scope;
  docTitle: string;
  link: string;
}

export function useCommentMutations(ctx: DocContext) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: queryKeys.comments.forDocument(ctx.documentId),
    });

  const create = useMutation({
    mutationFn: (input: {
      body: string;
      anchor?: unknown;
      blockId?: string | null;
      parentId?: string | null;
    }) =>
      createComment({
        documentId: ctx.documentId,
        scope: ctx.scope,
        docTitle: ctx.docTitle,
        link: ctx.link,
        ...input,
      }),
    onSuccess: invalidate,
  });

  const resolve = useMutation({
    mutationFn: (input: { commentId: string; resolved: boolean }) =>
      resolveComment({ ...input, scope: ctx.scope }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (input: { commentId: string }) =>
      deleteComment({ ...input, scope: ctx.scope }),
    onSuccess: invalidate,
  });

  return { create, resolve, remove };
}

export function useSuggestionMutations(ctx: DocContext) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: queryKeys.suggestions.forDocument(ctx.documentId),
    });

  const create = useMutation({
    mutationFn: (input: {
      patch: unknown;
      rationale?: string | null;
      baseContent?: unknown;
    }) =>
      createSuggestion({
        documentId: ctx.documentId,
        scope: ctx.scope,
        ...input,
      }),
    onSuccess: invalidate,
  });

  const resolve = useMutation({
    mutationFn: (input: {
      suggestionId: string;
      accept: boolean;
      liveContent?: unknown;
    }) =>
      resolveSuggestion({
        ...input,
        scope: ctx.scope,
        docTitle: ctx.docTitle,
        link: ctx.link,
      }),
    onSuccess: invalidate,
  });

  return { create, resolve };
}

export function useReviewMutations(ctx: DocContext) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: queryKeys.reviews.forDocument(ctx.documentId),
    });

  const submit = useMutation({
    mutationFn: (input: { decision: ReviewDecision; body?: string | null }) =>
      submitReview({
        documentId: ctx.documentId,
        scope: ctx.scope,
        docTitle: ctx.docTitle,
        link: ctx.link,
        ...input,
      }),
    onSuccess: invalidate,
  });

  const request = useMutation({
    mutationFn: (input: { reviewerIds: string[] }) =>
      requestReview({
        documentId: ctx.documentId,
        scope: ctx.scope,
        docTitle: ctx.docTitle,
        link: ctx.link,
        ...input,
      }),
  });

  return { submit, request };
}

export type {
  CommentThreadDto,
  ReviewDto,
  SuggestionDto,
};
