import { headers } from "next/headers";
import { notificationCursor } from "@forgespecs/core";

import { auth } from "@/lib/auth/auth";

/**
 * GET /api/notifications/stream — Server-Sent Events.
 *
 * Pushes a lightweight notification "ping" to the authenticated user whenever
 * their notification state changes (a new row, or a change in unread count).
 * Notification ROWS are written by domain actions (mentions/reviews/etc. — M5)
 * via `createNotification`; this stream only signals "something changed, refetch"
 * so the client's TanStack Query inbox/badge updates without polling.
 *
 * We poll the cheap `notificationCursor` (latest id + unread count) on an
 * interval and emit an SSE `message` only on change. This is intentionally
 * simple and single-replica friendly (no Redis pub/sub — that's M11); the
 * payload is tiny and the query is indexed on (recipientId, read).
 *
 * Runs on the Node runtime (Prisma) and is dynamic (per-user, never cached).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastId: string | null = null;
      let lastUnread = -1;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const tick = async (): Promise<void> => {
        if (closed) return;
        try {
          const cursor = await notificationCursor(userId);
          if (cursor.latestId !== lastId || cursor.unread !== lastUnread) {
            lastId = cursor.latestId;
            lastUnread = cursor.unread;
            send("notification", cursor);
          }
        } catch {
          // Transient DB hiccup — keep the stream alive; next tick retries.
        }
      };

      // Emit the initial state immediately so the client syncs on connect.
      await tick();

      const poll = setInterval(() => void tick(), POLL_INTERVAL_MS);
      // Comment heartbeat keeps proxies from closing an idle connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, HEARTBEAT_MS);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
