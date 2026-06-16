"use client";

import * as React from "react";
import { GitPullRequestArrow, MessageSquare, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MentionTarget } from "@/features/editor/ForgeEditor";

import { CommentsPanel } from "./comments-panel";
import { SuggestionsPanel } from "./suggestions-panel";
import { ReviewsPanel } from "./reviews-panel";
import type { DocContext } from "./use-collaboration";

type Tab = "comments" | "suggestions" | "reviews";

export interface CollaborationCapabilities {
  comment: boolean;
  commentResolve: boolean;
  suggest: boolean;
  suggestResolve: boolean;
  review: boolean;
}

/**
 * The right-hand collaboration panel for a spec: Comments / Suggestions /
 * Reviews. Shares the editor bridge (via context provided by SpecWorkspace) so
 * comment anchors resolve against the live Y.Doc and accepted suggestions apply
 * through the editor.
 */
export function CollaborationPanel({
  ctx,
  mentionTargets,
  caps,
  currentUserId,
}: {
  ctx: DocContext;
  mentionTargets: MentionTarget[];
  caps: CollaborationCapabilities;
  currentUserId: string | null;
}) {
  const [tab, setTab] = React.useState<Tab>("comments");

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <div className="flex shrink-0 border-b">
        <TabButton
          active={tab === "comments"}
          onClick={() => setTab("comments")}
          icon={<MessageSquare className="size-4" />}
          label="Comments"
        />
        <TabButton
          active={tab === "suggestions"}
          onClick={() => setTab("suggestions")}
          icon={<GitPullRequestArrow className="size-4" />}
          label="Suggestions"
        />
        <TabButton
          active={tab === "reviews"}
          onClick={() => setTab("reviews")}
          icon={<ShieldCheck className="size-4" />}
          label="Reviews"
        />
      </div>

      <div className="min-h-0 flex-1">
        {tab === "comments" ? (
          <CommentsPanel
            ctx={ctx}
            mentionTargets={mentionTargets}
            canComment={caps.comment}
            canResolve={caps.commentResolve}
            currentUserId={currentUserId}
          />
        ) : tab === "suggestions" ? (
          <SuggestionsPanel
            ctx={ctx}
            canSuggest={caps.suggest}
            canResolve={caps.suggestResolve}
          />
        ) : (
          <ReviewsPanel
            ctx={ctx}
            canReview={caps.review}
            members={mentionTargets}
          />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium transition-colors",
        active
          ? "border-b-2 border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
