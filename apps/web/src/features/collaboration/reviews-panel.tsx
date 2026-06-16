"use client";

import * as React from "react";
import { CheckCircle2, MessageCircle, XCircle } from "lucide-react";
import { ReviewDecision } from "@forgespecs/db";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MentionTarget } from "@/features/editor/ForgeEditor";

import {
  useReviews,
  useReviewMutations,
  type DocContext,
  type ReviewDto,
} from "./use-collaboration";

/**
 * Reviews panel: submit an approve / request-changes / comment decision (pinned
 * server-side to the document's current version), request review from members,
 * and list past reviews. An APPROVE review on the current version unblocks the
 * REVIEW → APPROVED status transition (enforced by the core gate).
 */
export function ReviewsPanel({
  ctx,
  canReview,
  members,
}: {
  ctx: DocContext;
  canReview: boolean;
  members: MentionTarget[];
}) {
  const { data: reviews = [], isLoading } = useReviews(ctx.documentId);
  const { submit, request } = useReviewMutations(ctx);
  const [body, setBody] = React.useState("");
  const [requesting, setRequesting] = React.useState(false);

  const decide = (decision: ReviewDecision): void => {
    submit.mutate(
      { decision, body: body.trim() || null },
      { onSuccess: () => setBody("") },
    );
  };

  const approvingOnCurrent = reviews.filter(
    (r) => r.decision === ReviewDecision.APPROVE && r.current,
  ).length;

  return (
    <div className="flex h-full flex-col">
      {canReview ? (
        <div className="space-y-2 border-b p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Review note (optional)…"
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={submit.isPending}
              onClick={() => decide(ReviewDecision.APPROVE)}
            >
              <CheckCircle2 className="size-4" />
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={submit.isPending}
              onClick={() => decide(ReviewDecision.REQUEST_CHANGES)}
            >
              <XCircle className="size-4" />
              Request changes
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={submit.isPending}
              onClick={() => decide(ReviewDecision.COMMENT)}
            >
              <MessageCircle className="size-4" />
              Comment
            </Button>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setRequesting((s) => !s)}
          >
            {requesting ? "Cancel request" : "Request a review…"}
          </button>
          {requesting ? (
            <RequestReview
              members={members}
              onRequest={(reviewerIds) => {
                request.mutate(
                  { reviewerIds },
                  { onSuccess: () => setRequesting(false) },
                );
              }}
              busy={request.isPending}
            />
          ) : null}
        </div>
      ) : null}

      <div className="px-3 py-2 text-xs text-muted-foreground">
        {approvingOnCurrent > 0
          ? `${approvingOnCurrent} approving review${approvingOnCurrent === 1 ? "" : "s"} on the current version`
          : "No approving review on the current version yet"}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reviews yet.</p>
        ) : (
          reviews.map((r) => <ReviewCard key={r.id} review={r} />)
        )}
      </div>
    </div>
  );
}

function RequestReview({
  members,
  onRequest,
  busy,
}: {
  members: MentionTarget[];
  onRequest: (reviewerIds: string[]) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const userMembers = members.filter((m) => m.kind === "user");
  return (
    <div className="space-y-2 rounded-md border p-2">
      {userMembers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No members to request.</p>
      ) : (
        userMembers.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
            />
            {m.label}
          </label>
        ))
      )}
      <Button
        type="button"
        size="sm"
        disabled={busy || selected.size === 0}
        onClick={() => onRequest([...selected])}
      >
        Request {selected.size > 0 ? `(${selected.size})` : ""}
      </Button>
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewDto }) {
  const meta = decisionMeta(review.decision);
  return (
    <div className="rounded-md border bg-card p-3 text-card-foreground">
      <div className="flex items-center gap-2">
        <span className={cn("flex items-center gap-1 text-sm font-medium", meta.color)}>
          <meta.Icon className="size-4" />
          {meta.label}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          v{review.versionNum}
          {review.current ? " · current" : ""}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {review.reviewerName ?? "Unknown"} ·{" "}
        {new Date(review.createdAt).toLocaleString()}
      </p>
      {review.body ? <p className="mt-1 text-sm">{review.body}</p> : null}
    </div>
  );
}

function decisionMeta(decision: ReviewDecision) {
  switch (decision) {
    case ReviewDecision.APPROVE:
      return {
        label: "Approved",
        Icon: CheckCircle2,
        color: "text-emerald-600 dark:text-emerald-400",
      };
    case ReviewDecision.REQUEST_CHANGES:
      return {
        label: "Changes requested",
        Icon: XCircle,
        color: "text-amber-600 dark:text-amber-400",
      };
    case ReviewDecision.COMMENT:
      return { label: "Comment", Icon: MessageCircle, color: "text-foreground" };
  }
}
