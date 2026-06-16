import type { MembershipLike } from "./scope";

/**
 * Clean interface decoupling RBAC from how sessions/memberships are sourced.
 * The web app wires this to Better Auth + Prisma; the collab process wires it
 * to the handshake cookie + Prisma. Tests provide a fake.
 */
export interface RbacContextProvider {
  /** Resolve the current user id, or null if unauthenticated. */
  getUserId(): Promise<string | null>;
  /** Load all membership rows for a user (across workspaces/projects). */
  getMembershipsForUser(userId: string): Promise<MembershipLike[]>;
}

/**
 * Module-level provider. Set once at app/process boot via setRbacProvider().
 * Kept as a slot (rather than DI everywhere) so Server Actions can call
 * requirePermission() with minimal ceremony.
 */
let provider: RbacContextProvider | undefined;

export function setRbacProvider(p: RbacContextProvider): void {
  provider = p;
}

export function getRbacProvider(): RbacContextProvider {
  if (!provider) {
    throw new Error(
      "RBAC provider not configured. Call setRbacProvider() at boot " +
        "(see apps/web/lib/auth setup or apps/collab handshake).",
    );
  }
  return provider;
}

/** Test/escape hatch: clear the configured provider. */
export function resetRbacProvider(): void {
  provider = undefined;
}
