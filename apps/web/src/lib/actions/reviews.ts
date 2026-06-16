"use server";

import {
  prisma,
  ActivityType,
  NotificationType,
  ReviewDecision,
  type Prisma,
} from "@forgespecs/db";
import {
  withPermission,
  logActivity,
  createNotification,
  type Scope,
} from "@forgespecs/core";

import "@/lib/auth/rbac";

/**
 * Review workflow Server Actions (M5).
 *
 * A Review is an APPROVE / REQUEST_CHANGES / COMMENT decision pinned to the
 * document's CURRENT `versionNum` at submission time. The approving-review gate
 * (≥1 APPROVE pinned to the current version) is enforced by the core status
 * machine when the doc is moved REVIEW → APPROVED (see
 * `changeDocumentStatus` / `countApprovingReviews`) — submitting an approve
 * review is what unblocks that transition.
 *
 * Requesting a review notifies the chosen reviewers; submitting a decision
 * notifies the document author. All mutations go through `withPermission`.
 */

const _requestReview = withPermission(
  (input: {
    documentId: string;
    reviewerIds: string[];
    scope: Scope;
    docTitle?: string;
    link?: string | null;
  }) => input.scope,
  "review.submit",
  async (actor, input): Promise<{ requested: number }> => {
    const recipients = input.reviewerIds.filter((id) => id !== actor.userId);

    await prisma.$transaction(async (tx) => {
      for (const reviewerId of recipients) {
        await createNotification(
          {
            recipientId: reviewerId,
            type: NotificationType.REVIEW_REQUESTED,
            title: `Review requested${
              input.docTitle ? ` on “${input.docTitle}”` : ""
            }`,
            link: input.link ?? null,
          },
          tx,
        );
      }
      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.REVIEW_SUBMITTED,
          entityType: "document",
          entityId: input.documentId,
          data: { requested: recipients },
        },
        tx,
      );
    });

    return { requested: recipients.length };
  },
);

export interface ReviewSubmitResult {
  id: string;
  decision: ReviewDecision;
  versionNum: number;
}

const _submitReview = withPermission(
  (input: {
    documentId: string;
    decision: ReviewDecision;
    body?: string | null;
    scope: Scope;
    docTitle?: string;
    link?: string | null;
  }) => input.scope,
  "review.submit",
  async (actor, input): Promise<ReviewSubmitResult> => {
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: input.documentId },
      select: { currentVersion: true, authorId: true },
    });

    const review = await prisma.$transaction(async (tx) => {
      const r = await tx.review.create({
        data: {
          documentId: input.documentId,
          reviewerId: actor.userId,
          decision: input.decision,
          versionNum: doc.currentVersion,
          body: input.body?.trim() || null,
        },
        select: { id: true, decision: true, versionNum: true },
      });

      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.REVIEW_SUBMITTED,
          entityType: "document",
          entityId: input.documentId,
          data: { reviewId: r.id, decision: input.decision, versionNum: r.versionNum },
        },
        tx,
      );

      // Notify the document author of the decision (not self).
      if (doc.authorId && doc.authorId !== actor.userId) {
        await createNotification(
          {
            recipientId: doc.authorId,
            type: NotificationType.REVIEW_DECIDED,
            title: `${decisionLabel(input.decision)}${
              input.docTitle ? ` — “${input.docTitle}”` : ""
            }`,
            body: input.body?.trim() || null,
            link: input.link ?? null,
          },
          tx,
        );
      }

      return r;
    });

    return review;
  },
);

function decisionLabel(decision: ReviewDecision): string {
  switch (decision) {
    case ReviewDecision.APPROVE:
      return "Review approved";
    case ReviewDecision.REQUEST_CHANGES:
      return "Changes requested";
    case ReviewDecision.COMMENT:
      return "Review comment";
  }
}

// ── exported Server Actions ────────────────────────────────────────────────

/** Request a review from one or more members. Requires `review.submit`. */
export async function requestReview(input: {
  documentId: string;
  reviewerIds: string[];
  scope: Scope;
  docTitle?: string;
  link?: string | null;
}): Promise<{ requested: number }> {
  return _requestReview(input);
}

/**
 * Submit a review decision pinned to the document's current version. Requires
 * `review.submit`. An APPROVE decision unblocks the REVIEW → APPROVED status
 * transition (enforced by the core gate).
 */
export async function submitReview(input: {
  documentId: string;
  decision: ReviewDecision;
  body?: string | null;
  scope: Scope;
  docTitle?: string;
  link?: string | null;
}): Promise<ReviewSubmitResult> {
  return _submitReview(input);
}
