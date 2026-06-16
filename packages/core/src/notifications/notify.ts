import {
  prisma,
  type NotificationType,
  type Prisma,
  type PrismaClient,
} from "@forgespecs/db";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  data?: Prisma.InputJsonValue;
}

/**
 * Write a `Notification` row for a recipient. Domain actions (mentions, reviews,
 * status changes — wired in M5) call this; the SSE stream in apps/web
 * (`/api/notifications/stream`) then pushes a lightweight "refetch" ping to the
 * recipient so their inbox/badge updates without polling.
 *
 * Accepts a transaction handle so the notification is written atomically with
 * the action that triggered it.
 */
export async function createNotification(
  input: CreateNotificationInput,
  db: Db = prisma,
): Promise<{ id: string }> {
  const row = await db.notification.create({
    data: {
      recipientId: input.recipientId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      data: input.data ?? undefined,
    },
    select: { id: true },
  });
  return row;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/** List a recipient's notifications (newest first), capped. */
export async function listNotifications(
  recipientId: string,
  opts: { unreadOnly?: boolean; take?: number } = {},
  db: Db = prisma,
): Promise<NotificationDto[]> {
  const rows = await db.notification.findMany({
    where: {
      recipientId,
      ...(opts.unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      read: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Count unread notifications for a recipient. Drives the inbox badge. */
export async function unreadCount(
  recipientId: string,
  db: Db = prisma,
): Promise<number> {
  return db.notification.count({ where: { recipientId, read: false } });
}

/**
 * The most recent notification id (cuid, time-sortable enough for change
 * detection) + the unread count. The SSE stream polls this cheaply and emits an
 * event only when either value changes, so the client refetches on demand
 * instead of streaming full payloads.
 */
export async function notificationCursor(
  recipientId: string,
  db: Db = prisma,
): Promise<{ latestId: string | null; unread: number }> {
  const [latest, unread] = await Promise.all([
    db.notification.findFirst({
      where: { recipientId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    unreadCount(recipientId, db),
  ]);
  return { latestId: latest?.id ?? null, unread };
}
