"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { useSession } from "@/lib/auth/client";
import { useWorkspace } from "@/lib/context/workspace-context";
import { useNotificationStream } from "@/lib/query/use-notification-stream";
import { Button } from "@/components/ui/button";

/**
 * Topbar inbox bell with a live unread badge. The badge count comes from the M4
 * SSE stream (`useNotificationStream`), which pushes a tiny cursor whenever the
 * user's notification state changes — no polling.
 */
export function InboxButton() {
  const { data: session } = useSession();
  const { workspaceSlug } = useWorkspace();
  const { unread } = useNotificationStream(session?.user?.id);

  return (
    <Button variant="ghost" size="icon" asChild aria-label="Inbox">
      <Link href={`/${workspaceSlug}/inbox`} className="relative">
        <Bell className="size-4" />
        {unread && unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
