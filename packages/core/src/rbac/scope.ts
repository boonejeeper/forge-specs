import { Role } from "@forgespecs/db";
import { ROLE_RANK } from "./permissions";

/**
 * The scope an action is evaluated against. A project-scoped action also
 * implies its parent workspace; resolution picks the most-specific membership.
 */
export type Scope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "project"; workspaceId: string; projectId: string };

/** A membership row as far as RBAC cares (decoupled from Prisma's row type). */
export interface MembershipLike {
  workspaceId: string;
  projectId: string | null;
  role: Role;
}

/**
 * Resolve the effective role for a user at a scope from their memberships.
 *
 * Rules:
 *  - A project-level membership (projectId === scope.projectId) overrides the
 *    workspace-level membership for that scope.
 *  - If both exist, the project membership wins (override semantics), even if it
 *    is a lower rank — explicit project overrides are intentional downgrades.
 *  - If no project membership exists, fall back to the workspace membership.
 *  - Among multiple workspace-level rows (shouldn't happen given the unique
 *    constraint, but defensive), the highest rank wins.
 *
 * Returns null when the user has no applicable membership.
 */
export function resolveEffectiveRole(
  memberships: readonly MembershipLike[],
  scope: Scope,
): Role | null {
  const inWorkspace = memberships.filter(
    (m) => m.workspaceId === scope.workspaceId,
  );
  if (inWorkspace.length === 0) return null;

  if (scope.kind === "project") {
    const projectMembership = inWorkspace.find(
      (m) => m.projectId === scope.projectId,
    );
    if (projectMembership) return projectMembership.role;
  }

  // Workspace-level fallback (projectId === null). Highest rank wins.
  const workspaceLevel = inWorkspace.filter((m) => m.projectId === null);
  if (workspaceLevel.length === 0) return null;

  return workspaceLevel.reduce<Role>((best, m) => {
    return ROLE_RANK[m.role] > ROLE_RANK[best] ? m.role : best;
  }, workspaceLevel[0]!.role);
}
