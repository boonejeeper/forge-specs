import "server-only";

import { prisma, type ActivityType } from "@forgespecs/db";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

function map(rows: {
  id: string;
  type: ActivityType;
  entityType: string | null;
  entityId: string | null;
  data: unknown;
  createdAt: Date;
  actor: { name: string } | null;
}[]): ActivityItem[] {
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actorName: r.actor?.name ?? null,
    entityType: r.entityType,
    entityId: r.entityId,
    data: (r.data as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Workspace-wide activity, most recent first. */
export async function listWorkspaceActivity(
  workspaceId: string,
  limit = 50,
): Promise<ActivityItem[]> {
  const rows = await prisma.activityEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      data: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
  return map(rows);
}

/**
 * Security-relevant activity types surfaced in the workspace AUDIT LOG (M11).
 * A subset of all activity, focused on actions that change access, status, or
 * provenance: role changes, status approvals, restores, template applies, SSO
 * logins, member changes, and PR linkage.
 */
export const AUDIT_LOG_TYPES = [
  "MEMBER_ADDED",
  "MEMBER_REMOVED",
  "MEMBER_ROLE_CHANGED",
  "STATUS_CHANGED",
  "VERSION_RESTORED",
  "TEMPLATE_APPLIED",
  "SSO_LOGIN",
  "PR_LINKED",
  "PR_STATUS_CHANGED",
] as const satisfies readonly ActivityType[];

/** Workspace audit log — security-relevant events only, most recent first. */
export async function listWorkspaceAuditLog(
  workspaceId: string,
  limit = 100,
): Promise<ActivityItem[]> {
  const rows = await prisma.activityEvent.findMany({
    where: { workspaceId, type: { in: [...AUDIT_LOG_TYPES] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      data: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
  return map(rows);
}

/** Activity scoped to a single document. */
export async function listDocumentActivity(
  workspaceId: string,
  documentId: string,
  limit = 50,
): Promise<ActivityItem[]> {
  const rows = await prisma.activityEvent.findMany({
    where: { workspaceId, entityType: "document", entityId: documentId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      data: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
  return map(rows);
}
