/**
 * Handshake authentication + authorization for the collab server.
 *
 * The collab process is a SEPARATE Node process from the web app, but it must
 * make the EXACT same authorization decision — otherwise realtime collab is a
 * silent RBAC bypass (plan risk #3). We achieve that two ways:
 *
 *  1. Session validation reuses Better Auth. We construct an equivalent Better
 *     Auth instance here (same secret, same Prisma DB, same cookie prefix as
 *     apps/web) and call `auth.api.getSession({ headers })`, passing the WS
 *     upgrade request's headers (which carry the session cookie). This reuses
 *     Better Auth's own signed-cookie verification and session lookup — no
 *     fragile hand-rolled cookie parsing or signature checking.
 *
 *  2. Permission resolution reuses `@forgespecs/core`'s `requirePermission` —
 *     the very same chokepoint the web Server Actions use — wired to a provider
 *     backed by the resolved userId + Prisma memberships.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@forgespecs/db";
import { env, AUTH_COOKIE_PREFIX } from "@forgespecs/config";
import {
  requirePermission,
  setRbacProvider,
  isForbiddenError,
  UnauthorizedError,
  type MembershipLike,
  type RbacContextProvider,
  type Scope,
  type AuthorizedActor,
} from "@forgespecs/core";

/**
 * Collab-side Better Auth instance. Intentionally minimal: it only needs to
 * VALIDATE existing sessions (no sign-in routes are mounted here). Crucially it
 * shares the secret, database and cookie prefix with the web instance so the
 * cookies the browser already holds verify here too.
 */
export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  advanced: {
    cookiePrefix: AUTH_COOKIE_PREFIX,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: { enabled: true },
});

/**
 * The RBAC provider is keyed per-request (each handshake resolves its own
 * userId), so we use AsyncLocalStorage-free request scoping: the provider reads
 * the userId resolved for the current handshake. Because handshakes are awaited
 * sequentially within a single requirePermission call, we pass the userId
 * explicitly via the `opts.userId` escape hatch instead of through the slot.
 */
const collabRbacProvider: RbacContextProvider = {
  // Never used (we always pass userId explicitly), but required by the interface.
  async getUserId(): Promise<string | null> {
    return null;
  },
  async getMembershipsForUser(userId: string): Promise<MembershipLike[]> {
    return prisma.membership.findMany({
      where: { userId },
      select: { workspaceId: true, projectId: true, role: true },
    });
  },
};

let installed = false;
export function ensureRbacProvider(): void {
  if (installed) return;
  setRbacProvider(collabRbacProvider);
  installed = true;
}

export class HandshakeError extends Error {
  constructor(
    message: string,
    readonly code: 401 | 403 | 404,
  ) {
    super(message);
    this.name = "HandshakeError";
  }
}

/**
 * Resolve the authenticated user from the upgrade request's cookies.
 * Throws HandshakeError(401) when there is no valid session.
 */
async function resolveUserId(headers: Headers): Promise<string> {
  const session = await auth.api.getSession({ headers });
  const userId = session?.user?.id;
  if (!userId) {
    throw new HandshakeError("No valid session.", 401);
  }
  return userId;
}

/**
 * Resolve the workspace/project scope for a room (documentId). The collab room
 * name is the documentId; we look up its project + workspace to evaluate
 * project-scoped `doc.edit`. Throws HandshakeError(404) for unknown documents.
 */
async function scopeForDocument(documentId: string): Promise<Scope> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { project: { select: { id: true, workspaceId: true } } },
  });
  if (!doc) {
    throw new HandshakeError("Document not found.", 404);
  }
  return {
    kind: "project",
    workspaceId: doc.project.workspaceId,
    projectId: doc.project.id,
  };
}

export interface AuthorizedHandshake {
  userId: string;
  actor: AuthorizedActor;
  /** Display info pushed into the editor's awareness for cursor labels. */
  user: { id: string; name: string };
}

/**
 * THE handshake gate. Validates the session cookie, resolves the room's scope,
 * and requires `doc.edit` via the shared core chokepoint. Returns the authorized
 * actor + display info on success; throws HandshakeError otherwise.
 *
 * Note: `doc.edit` (not `doc.read`) is required — connecting to the collab room
 * grants live write access, so read-only roles must use the REST read path. The
 * web client only opens a provider when it rendered the editor as editable.
 */
export async function authorizeHandshake(
  documentId: string,
  headers: Headers,
): Promise<AuthorizedHandshake> {
  ensureRbacProvider();

  const userId = await resolveUserId(headers);
  const scope = await scopeForDocument(documentId);

  let actor: AuthorizedActor;
  try {
    actor = await requirePermission(scope, "doc.edit", { userId });
  } catch (err) {
    if (isForbiddenError(err) || err instanceof UnauthorizedError) {
      throw new HandshakeError("Not permitted to edit this document.", 403);
    }
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });

  return {
    userId,
    actor,
    user: { id: userId, name: user?.name ?? "Anonymous" },
  };
}
