import { getRbacProvider, type RbacContextProvider } from "./context";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { roleHasPermission, type Permission } from "./permissions";
import { resolveEffectiveRole, type Scope } from "./scope";

export interface AuthorizedActor {
  userId: string;
  /** The effective role resolved at the requested scope. */
  role: import("@forgespecs/db").Role;
  scope: Scope;
}

/**
 * THE authorization chokepoint. Resolves the session, finds the most-specific
 * membership for `scope`, checks the capability, and throws on failure.
 *
 * Reused identically by Server Actions (via withPermission) and the collab WS
 * handshake — there is exactly one place the role→capability decision lives.
 *
 * @param scope      workspace or project scope to evaluate against
 * @param permission required capability
 * @param opts.provider override the module provider (used by collab/tests)
 */
export async function requirePermission(
  scope: Scope,
  permission: Permission,
  opts?: { provider?: RbacContextProvider; userId?: string },
): Promise<AuthorizedActor> {
  const provider = opts?.provider ?? getRbacProvider();

  const userId = opts?.userId ?? (await provider.getUserId());
  if (!userId) {
    throw new UnauthorizedError();
  }

  const memberships = await provider.getMembershipsForUser(userId);
  const role = resolveEffectiveRole(memberships, scope);

  if (!role) {
    throw new ForbiddenError("You are not a member of this workspace.", {
      permission,
      scope,
    });
  }

  if (!roleHasPermission(role, permission)) {
    throw new ForbiddenError(
      `Role ${role} cannot perform "${permission}".`,
      { permission, scope },
    );
  }

  return { userId, role, scope };
}

/**
 * Wrap a Server Action (or any async fn) so it only runs when the actor holds
 * `permission` at `scope`. The wrapped fn receives the resolved actor as its
 * first argument, followed by the caller's args.
 *
 * Usage:
 *   export const deleteDoc = withPermission(
 *     (scope, docId: string) => scope,        // derive scope from args
 *     "doc.delete",
 *     async (actor, docId: string) => { ... } // body
 *   );
 */
export function withPermission<Args extends unknown[], Result>(
  scopeFor: (...args: Args) => Scope,
  permission: Permission,
  fn: (actor: AuthorizedActor, ...args: Args) => Promise<Result>,
  opts?: { provider?: RbacContextProvider },
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    const scope = scopeFor(...args);
    const actor = await requirePermission(scope, permission, opts);
    return fn(actor, ...args);
  };
}
