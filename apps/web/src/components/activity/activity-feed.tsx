import { ActivityType } from "@forgespecs/db";
import {
  Activity as ActivityIcon,
  ArrowRightLeft,
  FilePlus,
  FilePen,
  GitCommitVertical,
  GitPullRequestArrow,
  History,
  KeyRound,
  LayoutTemplate,
  MessageSquare,
  ShieldCheck,
  UserCog,
  UserMinus,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ActivityItem } from "@/lib/data/activity";

const ICONS: Partial<Record<ActivityType, LucideIcon>> = {
  [ActivityType.DOCUMENT_CREATED]: FilePlus,
  [ActivityType.DOCUMENT_UPDATED]: FilePen,
  [ActivityType.STATUS_CHANGED]: ArrowRightLeft,
  [ActivityType.VERSION_CREATED]: GitCommitVertical,
  [ActivityType.COMMENT_ADDED]: MessageSquare,
  [ActivityType.SUGGESTION_CREATED]: GitPullRequestArrow,
  [ActivityType.SUGGESTION_RESOLVED]: GitPullRequestArrow,
  [ActivityType.REVIEW_SUBMITTED]: ShieldCheck,
  [ActivityType.MEMBER_ADDED]: UserPlus,
  [ActivityType.MEMBER_REMOVED]: UserMinus,
  [ActivityType.MEMBER_ROLE_CHANGED]: UserCog,
  [ActivityType.VERSION_RESTORED]: History,
  [ActivityType.TEMPLATE_APPLIED]: LayoutTemplate,
  [ActivityType.SSO_LOGIN]: KeyRound,
  [ActivityType.PR_LINKED]: GitPullRequestArrow,
  [ActivityType.PR_STATUS_CHANGED]: GitPullRequestArrow,
};

function describe(item: ActivityItem): string {
  const actor = item.actorName ?? "Someone";
  const d = item.data ?? {};
  switch (item.type) {
    case ActivityType.DOCUMENT_CREATED:
      return `${actor} created “${str(d.title) ?? "a document"}”`;
    case ActivityType.DOCUMENT_UPDATED:
      if (d.deleted) return `${actor} deleted “${str(d.title) ?? "a document"}”`;
      if (d.frontmatter) return `${actor} updated metadata`;
      if (d.title) return `${actor} renamed a document to “${str(d.title)}”`;
      return `${actor} updated a document`;
    case ActivityType.STATUS_CHANGED:
      return `${actor} moved status ${str(d.from) ?? "?"} → ${str(d.to) ?? "?"}`;
    case ActivityType.VERSION_CREATED:
      return `${actor} snapshotted version ${num(d.versionNum) ?? "?"}`;
    case ActivityType.COMMENT_ADDED:
      if (typeof d.resolved === "boolean")
        return `${actor} ${d.resolved ? "resolved" : "reopened"} a comment thread`;
      return `${actor} ${d.reply ? "replied to a thread" : "started a comment thread"}`;
    case ActivityType.SUGGESTION_CREATED:
      return `${actor} proposed an edit`;
    case ActivityType.SUGGESTION_RESOLVED:
      return `${actor} ${
        str(d.status) === "ACCEPTED" ? "accepted" : "rejected"
      } a suggestion`;
    case ActivityType.REVIEW_SUBMITTED:
      if (d.decision)
        return `${actor} submitted a review (${str(d.decision)})`;
      return `${actor} requested a review`;
    case ActivityType.MEMBER_ADDED:
      return `${actor} added a member${d.role ? ` as ${str(d.role)}` : ""}`;
    case ActivityType.MEMBER_REMOVED:
      return `${actor} removed a member`;
    case ActivityType.MEMBER_ROLE_CHANGED:
      return `${actor} changed a member's role ${str(d.previousRole) ?? "?"} → ${str(d.newRole) ?? "?"}`;
    case ActivityType.VERSION_RESTORED:
      return `${actor} restored version from v${num(d.restoredFrom) ?? "?"}`;
    case ActivityType.TEMPLATE_APPLIED:
      return `${actor} applied template “${str(d.templateName) ?? str(d.templateId) ?? "?"}”`;
    case ActivityType.SSO_LOGIN:
      return `${actor} signed in via SSO (${str(d.provider) ?? "?"})`;
    case ActivityType.PR_LINKED:
      return `${actor} linked PR #${num(d.number) ?? "?"}`;
    case ActivityType.PR_STATUS_CHANGED:
      return `PR #${num(d.number) ?? "?"} is now ${str(d.state) ?? "?"}`;
    default:
      return `${actor} — ${item.type}`;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/** Renders an activity event list. Server component (no interactivity needed). */
export function ActivityFeed({
  items,
  workspaceSlug: _workspaceSlug,
}: {
  items: ActivityItem[];
  workspaceSlug: string;
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.type] ?? ActivityIcon;
        return (
          <li
            key={item.id}
            className="flex items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent/40"
          >
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3.5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <p>{describe(item)}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
