"use server";

import { revalidatePath } from "next/cache";
import { prisma, ActivityType, Role, type Prisma } from "@forgespecs/db";
import { withPermission, logActivity, type Scope } from "@forgespecs/core";

import "@/lib/auth/rbac"; // installs the RBAC provider on import

/**
 * Workspace member management Server Actions (M11).
 *
 * Role changes are SECURITY-RELEVANT, so every mutation writes a
 * MEMBER_ROLE_CHANGED / MEMBER_REMOVED ActivityEvent atomically with the change
 * (audit hardening). Guarded by `workspace.members.manage` through the single
 * RBAC chokepoint.
 */

const workspaceScope = (workspaceId: string): Scope => ({
  kind: "workspace",
  workspaceId,
});

const _changeMemberRole = withPermission(
  (input: { workspaceId: string; membershipId: string; role: Role }) =>
    workspaceScope(input.workspaceId),
  "workspace.members.manage",
  async (
    actor,
    input,
  ): Promise<{ membershipId: string; role: Role }> => {
    const membership = await prisma.membership.findUnique({
      where: { id: input.membershipId },
      select: { id: true, role: true, userId: true, workspaceId: true, projectId: true },
    });
    if (!membership || membership.workspaceId !== input.workspaceId) {
      throw new Error("Membership not found in this workspace.");
    }

    // Guard: don't allow demoting the last OWNER (lockout protection).
    if (membership.role === Role.OWNER && input.role !== Role.OWNER) {
      const ownerCount = await prisma.membership.count({
        where: {
          workspaceId: input.workspaceId,
          projectId: null,
          role: Role.OWNER,
        },
      });
      if (ownerCount <= 1 && membership.projectId === null) {
        throw new Error("Cannot demote the last workspace owner.");
      }
    }

    const previousRole = membership.role;
    if (previousRole === input.role) {
      return { membershipId: membership.id, role: input.role };
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { role: input.role },
      });
      await logActivity(
        {
          workspaceId: input.workspaceId,
          actorId: actor.userId,
          type: ActivityType.MEMBER_ROLE_CHANGED,
          entityType: "user",
          entityId: membership.userId,
          data: {
            membershipId: membership.id,
            previousRole,
            newRole: input.role,
            projectId: membership.projectId,
          } as Prisma.InputJsonValue,
        },
        tx,
      );
    });

    revalidatePath("/", "layout");
    return { membershipId: membership.id, role: input.role };
  },
);

/** Change a workspace member's role. Requires `workspace.members.manage`. */
export async function changeMemberRole(input: {
  workspaceId: string;
  membershipId: string;
  role: Role;
}): Promise<{ membershipId: string; role: Role }> {
  return _changeMemberRole(input);
}

const _removeMember = withPermission(
  (input: { workspaceId: string; membershipId: string }) =>
    workspaceScope(input.workspaceId),
  "workspace.members.manage",
  async (actor, input): Promise<{ removed: true }> => {
    const membership = await prisma.membership.findUnique({
      where: { id: input.membershipId },
      select: { id: true, role: true, userId: true, workspaceId: true, projectId: true },
    });
    if (!membership || membership.workspaceId !== input.workspaceId) {
      throw new Error("Membership not found in this workspace.");
    }
    if (membership.role === Role.OWNER && membership.projectId === null) {
      const ownerCount = await prisma.membership.count({
        where: { workspaceId: input.workspaceId, projectId: null, role: Role.OWNER },
      });
      if (ownerCount <= 1) throw new Error("Cannot remove the last workspace owner.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.delete({ where: { id: membership.id } });
      await logActivity(
        {
          workspaceId: input.workspaceId,
          actorId: actor.userId,
          type: ActivityType.MEMBER_REMOVED,
          entityType: "user",
          entityId: membership.userId,
          data: {
            membershipId: membership.id,
            role: membership.role,
            projectId: membership.projectId,
          } as Prisma.InputJsonValue,
        },
        tx,
      );
    });

    revalidatePath("/", "layout");
    return { removed: true };
  },
);

/** Remove a workspace member. Requires `workspace.members.manage`. */
export async function removeMember(input: {
  workspaceId: string;
  membershipId: string;
}): Promise<{ removed: true }> {
  return _removeMember(input);
}
