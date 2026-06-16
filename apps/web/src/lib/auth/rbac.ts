import "server-only";

import { headers } from "next/headers";
import { prisma } from "@forgespecs/db";
import {
  setRbacProvider,
  requirePermission,
  isForbiddenError,
  UnauthorizedError,
  type MembershipLike,
  type Permission,
  type RbacContextProvider,
  type Scope,
} from "@forgespecs/core";

import { auth } from "./auth";

/**
 * Wires @forgespecs/core's RBAC chokepoint to Better Auth (session) + Prisma
 * (memberships) for the Next.js process. Server Actions can then call
 * `requirePermission(scope, perm)` / `withPermission(...)` with no extra args.
 *
 * The same `requirePermission` is reused at the collab WS handshake (M4) with a
 * provider built from the handshake cookie — identical decision, two processes.
 */
const webRbacProvider: RbacContextProvider = {
  async getUserId(): Promise<string | null> {
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
  },

  async getMembershipsForUser(userId: string): Promise<MembershipLike[]> {
    const rows = await prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true, projectId: true, role: true },
    });
    return rows;
  },
};

let installed = false;

/** Idempotently install the web RBAC provider. Call before any requirePermission. */
export function ensureRbacProvider(): void {
  if (installed) return;
  setRbacProvider(webRbacProvider);
  installed = true;
}

// Install on module import so Server Actions importing the RBAC helpers are ready.
ensureRbacProvider();

/**
 * Non-throwing capability check for RSC gating (e.g. render the editor read-only
 * when the user lacks `doc.edit`). The mutating Server Actions still enforce the
 * same permission via `withPermission` — this only chooses what UI to paint.
 */
export async function can(scope: Scope, permission: Permission): Promise<boolean> {
  ensureRbacProvider();
  try {
    await requirePermission(scope, permission);
    return true;
  } catch (err) {
    if (isForbiddenError(err) || err instanceof UnauthorizedError) return false;
    throw err;
  }
}
