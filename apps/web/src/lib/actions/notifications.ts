"use server";

import { headers } from "next/headers";
import { prisma } from "@forgespecs/db";

import { auth } from "@/lib/auth/auth";

import "@/lib/auth/rbac";

/**
 * Notification (inbox) Server Actions (M5).
 *
 * Notifications are recipient-scoped, so authorization is identity-based (you
 * may only touch your own rows) rather than workspace-RBAC — every query is
 * filtered by the resolved session user id, so a user can never read or mutate
 * another user's inbox. Rows themselves are written by domain actions (mentions,
 * reviews, suggestions, status changes) via `createNotification`.
 */

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not authenticated.");
  return userId;
}

/** Mark a single notification read (or unread). Owner-scoped. */
export async function markNotificationRead(input: {
  id: string;
  read?: boolean;
}): Promise<{ id: string; read: boolean }> {
  const userId = await requireUserId();
  // updateMany with the recipient filter guarantees you can't mark another
  // user's notification (it simply matches zero rows).
  const read = input.read ?? true;
  await prisma.notification.updateMany({
    where: { id: input.id, recipientId: userId },
    data: { read },
  });
  return { id: input.id, read };
}

/** Mark all of the current user's notifications read. */
export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const userId = await requireUserId();
  const res = await prisma.notification.updateMany({
    where: { recipientId: userId, read: false },
    data: { read: true },
  });
  return { count: res.count };
}
