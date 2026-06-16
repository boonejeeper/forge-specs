import { Role } from "@forgespecs/db";

/**
 * The complete set of capabilities a role can be granted. Server Actions and
 * the collab handshake check against these — never against raw role strings.
 */
export const PERMISSIONS = [
  // Workspace administration
  "workspace.manage", // rename, delete, billing
  "workspace.members.manage", // invite/remove members, change roles
  "project.create",
  "project.manage", // rename/delete a project, manage project members

  // Documents
  "doc.create",
  "doc.read",
  "doc.edit", // body + metadata edits (also gates collab edit)
  "doc.delete",
  "doc.changeStatus", // move along the status state machine
  "doc.manageDependencies",

  // Collaboration
  "comment.create",
  "comment.resolve",
  "suggestion.create",
  "suggestion.resolve", // accept/reject
  "review.submit",

  // AI
  "ai.invoke", // run AI flows / chat

  // Templates
  "template.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

/**
 * Role → capability map. Single source of truth for authorization.
 *
 * OWNER     — full control of the workspace.
 * ARCHITECT — full document lifecycle incl. status transitions & project mgmt.
 * ENGINEER  — author and edit docs, comment, suggest, invoke AI.
 * REVIEWER  — read, comment, suggest, submit reviews; cannot edit body directly.
 * VIEWER    — read-only.
 */
export const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Permission>> = {
  [Role.OWNER]: new Set(ALL),

  [Role.ARCHITECT]: new Set<Permission>([
    "project.create",
    "project.manage",
    "doc.create",
    "doc.read",
    "doc.edit",
    "doc.delete",
    "doc.changeStatus",
    "doc.manageDependencies",
    "comment.create",
    "comment.resolve",
    "suggestion.create",
    "suggestion.resolve",
    "review.submit",
    "ai.invoke",
    "template.manage",
  ]),

  [Role.ENGINEER]: new Set<Permission>([
    "doc.create",
    "doc.read",
    "doc.edit",
    "doc.manageDependencies",
    "comment.create",
    "comment.resolve",
    "suggestion.create",
    "ai.invoke",
  ]),

  [Role.REVIEWER]: new Set<Permission>([
    "doc.read",
    "comment.create",
    "comment.resolve",
    "suggestion.create",
    "review.submit",
    "ai.invoke",
  ]),

  [Role.VIEWER]: new Set<Permission>(["doc.read"]),
};

/** Ordering for "most privileged wins" comparisons where needed. */
export const ROLE_RANK: Record<Role, number> = {
  [Role.OWNER]: 5,
  [Role.ARCHITECT]: 4,
  [Role.ENGINEER]: 3,
  [Role.REVIEWER]: 2,
  [Role.VIEWER]: 1,
};

/** Does `role` carry `permission`? */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_CAPABILITIES[role].has(permission);
}

/** All permissions for a role as a plain array (useful for serialization). */
export function capabilitiesForRole(role: Role): Permission[] {
  return [...ROLE_CAPABILITIES[role]];
}
