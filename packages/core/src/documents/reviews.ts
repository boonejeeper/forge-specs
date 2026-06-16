/**
 * Review helpers — the data side of the review workflow + the approving-review
 * gate the status machine consults.
 *
 * A `Review` is an APPROVE / REQUEST_CHANGES / COMMENT decision pinned to the
 * document's `versionNum` at the time of review. The status state machine's
 * REVIEW → APPROVED transition requires ≥1 APPROVE review pinned to the current
 * version (see `status-machine.ts`); this module resolves that count so the
 * action can pass it into `assertTransition`.
 *
 * Kept in core (not the web action) so the gate rule is unit-testable and shared
 * with any other transition entry point.
 */
import {
  prisma,
  ReviewDecision,
  type Prisma,
  type PrismaClient,
} from "@forgespecs/db";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Count APPROVE-decision reviews pinned to a document's CURRENT version. A
 * review pinned to an older version doesn't count — re-opening review (APPROVED
 * → REVIEW) and editing bumps the version via snapshots, so stale approvals
 * don't silently re-approve a changed doc.
 */
export async function countApprovingReviews(
  documentId: string,
  db: Db = prisma,
): Promise<number> {
  const doc = await db.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { currentVersion: true },
  });
  return db.review.count({
    where: {
      documentId,
      decision: ReviewDecision.APPROVE,
      versionNum: doc.currentVersion,
    },
  });
}

export interface ReviewDto {
  id: string;
  decision: ReviewDecision;
  versionNum: number;
  body: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  createdAt: string;
  /** True when this review is pinned to the document's current version. */
  current: boolean;
}

/** List a document's reviews (newest first) with current-version flagging. */
export async function listReviews(
  documentId: string,
  db: Db = prisma,
): Promise<ReviewDto[]> {
  const doc = await db.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { currentVersion: true },
  });
  const rows = await db.review.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      decision: true,
      versionNum: true,
      body: true,
      reviewerId: true,
      reviewer: { select: { name: true } },
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    versionNum: r.versionNum,
    body: r.body,
    reviewerId: r.reviewerId,
    reviewerName: r.reviewer?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    current: r.versionNum === doc.currentVersion,
  }));
}
