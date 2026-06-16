"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "./keys";

export interface NotificationPing {
  latestId: string | null;
  unread: number;
}

/**
 * Subscribe to the server-sent notification stream and refetch the inbox / unread
 * badge whenever the server signals a change.
 *
 * The stream pushes only a tiny cursor `{ latestId, unread }`; the actual rows
 * are fetched via the normal TanStack Query inbox query, so this hook just
 * invalidates the relevant keys (and exposes the latest unread count for an
 * optimistic badge). Auto-reconnects via the browser's native EventSource.
 *
 * Pass the current user's id so cache invalidation targets the right keys.
 */
export function useNotificationStream(
  userId: string | undefined,
): { unread: number | null } {
  const queryClient = useQueryClient();
  const [unread, setUnread] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!userId) return;
    if (typeof window === "undefined") return;

    const source = new EventSource("/api/notifications/stream");

    const onNotification = (e: MessageEvent): void => {
      try {
        const ping = JSON.parse(e.data) as NotificationPing;
        setUnread(ping.unread);
        // Refetch the inbox list + unread count for this user.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.inbox(userId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.unreadCount(userId),
        });
      } catch {
        // Ignore malformed events.
      }
    };

    source.addEventListener("notification", onNotification);

    return () => {
      source.removeEventListener("notification", onNotification);
      source.close();
    };
  }, [userId, queryClient]);

  return { unread };
}
