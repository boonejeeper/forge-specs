"use client";

import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";

/**
 * Browser auth client. Same-origin, so no baseURL needed. The ssoClient plugin
 * adds signIn.sso({ providerId, callbackURL }) for OIDC/SAML SSO.
 */
export const authClient = createAuthClient({
  plugins: [ssoClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
