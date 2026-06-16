"use client";

import * as React from "react";
import Link from "next/link";
import {
  AtSign,
  Bell,
  CheckCheck,
  GitPullRequestArrow,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotificationType } from "@forgespecs/db";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import { useNotificationStream } from "@/lib/query/use-notification-stream";
import { fetchInbox } from "@/lib/actions/reads";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications";
import type { InboxItem } from "@/lib/data/collaboration";

const ICONS: Partial<Record<string, LucideIcon>> = {
  [NotificationType.MENTION]: AtSign,
  [NotificationType.COMMENT]: MessageSquare,
  [NotificationType.REVIEW_REQUESTED]: ShieldCheck,
  [NotificationType.REVIEW_DECIDED]: ShieldCheck,
  [NotificationType.SUGGESTION]: GitPullRequestArrow,
};

/**
 * Notification inbox. Lists the current user's notifications, supports mark-read
 * / mark-all-read, and consumes the M4 SSE stream so new notifications appear
 * live (the stream pushes a cursor; this query refetches on each ping).
 */
export function Inbox({ userId }: { userId: string }) {
  const qc = useQueryClient();
  // Subscribe to the SSE stream — it invalidates the inbox key on change.
  useNotificationStream(userId);

  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.notifications.inbox(userId),
    queryFn: () => fetchInbox(),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.notifications.inbox(userId) });
    void qc.invalidateQueries({
      queryKey: queryKeys.notifications.unreadCount(userId),
    });
  };

  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationRead({ id }),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: invalidate,
  });

  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <Bell className="size-5" />
        <h1 className="text-lg font-semibold">Inbox</h1>
        {unread > 0 ? (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            {unread}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck className="size-4" />
          Mark all read
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              onMarkRead={() => markOne.mutate(item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  item,
  onMarkRead,
}: {
  item: InboxItem;
  onMarkRead: () => void;
}) {
  const Icon = ICONS[item.type] ?? Bell;
  const inner = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent/50",
        !item.read && "bg-accent/30",
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-3.5 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn(!item.read && "font-medium")}>{item.title}</p>
        {item.body ? (
          <p className="truncate text-xs text-muted-foreground">{item.body}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {new Date(item.createdAt).toLocaleString()}
        </p>
      </div>
      {!item.read ? (
        <button
          type="button"
          aria-label="Mark read"
          onClick={(e) => {
            e.preventDefault();
            onMarkRead();
          }}
          className="mt-1 size-2 shrink-0 rounded-full bg-primary"
        />
      ) : null}
    </div>
  );

  return item.link ? (
    <li>
      <Link href={item.link} onClick={onMarkRead}>
        {inner}
      </Link>
    </li>
  ) : (
    <li>{inner}</li>
  );
}
