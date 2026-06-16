import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { sso } from "@better-auth/sso";
import { prisma } from "@forgespecs/db";
import { env, AUTH_COOKIE_PREFIX } from "@forgespecs/config";

/**
 * Better Auth server instance. Owns User/Session/Account/Verification (+ the
 * @better-auth/sso plugin's SsoProvider table) via the Prisma adapter. Provides
 * email/password + GitHub + Google + OIDC/SAML SSO.
 *
 * The `sso()` plugin mounts /api/auth/sign-in/sso, /sso/register, /sso/callback,
 * /sso/saml2/* etc. It is always mounted (cheap, no IdP calls at boot); actual
 * providers are seeded from env by ensureSsoProviders() (see lib/auth/sso.ts) and
 * are gracefully absent when SSO_* env is unset — the app builds + runs with no
 * IdP configured.
 */
export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Deterministic cookie name shared with the collab process, which rebuilds an
  // equivalent Better Auth instance and validates the same session cookie at the
  // WS handshake (see apps/collab/src/auth.ts).
  advanced: {
    cookiePrefix: AUTH_COOKIE_PREFIX,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  // Audit hardening (M11): record SSO logins. A session is created on every
  // sign-in; we detect an SSO/OIDC/SAML session by checking the most recent
  // Account row's providerId against the registered SSO providers and, if it
  // matches, write an SSO_LOGIN ActivityEvent to each workspace the user belongs
  // to. Fully defensive — never blocks or fails the login.
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          try {
            const userId = (session as { userId?: string }).userId;
            if (!userId) return;
            const ssoProviderIds = await prisma.ssoProvider.findMany({
              select: { providerId: true },
            });
            if (ssoProviderIds.length === 0) return;
            const ids = new Set(ssoProviderIds.map((p) => p.providerId));
            const account = await prisma.account.findFirst({
              where: { userId },
              orderBy: { updatedAt: "desc" },
              select: { providerId: true },
            });
            if (!account || !ids.has(account.providerId)) return;
            const memberships = await prisma.membership.findMany({
              where: { userId },
              select: { workspaceId: true },
              distinct: ["workspaceId"],
            });
            for (const m of memberships) {
              await prisma.activityEvent.create({
                data: {
                  workspaceId: m.workspaceId,
                  actorId: userId,
                  type: "SSO_LOGIN",
                  entityType: "user",
                  entityId: userId,
                  data: { provider: account.providerId },
                },
              });
            }
          } catch (err) {
            console.error("[auth] SSO_LOGIN audit hook failed:", err);
          }
        },
      },
    },
  },
  // sso() before nextCookies(): OIDC/SAML sign-in + provider registration.
  // nextCookies() MUST be last — bridges Better Auth cookies into the Next.js
  // cookie store for Server Actions / RSC.
  plugins: [sso(), nextCookies()],
});

export type Auth = typeof auth;
