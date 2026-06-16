import "server-only";

import { prisma } from "@forgespecs/db";
import { env } from "@forgespecs/config";

/**
 * Config-driven SSO provisioning (M11).
 *
 * @better-auth/sso stores providers in the `SsoProvider` table and normally
 * registers them via an authenticated /sso/register call. For a self-hosted,
 * env-driven deployment we instead SEED the provider rows from environment
 * variables at boot — idempotently — so an operator configures SSO purely by
 * setting env, with no admin UI dance. The plugin then reads these rows for
 * /sign-in/sso?providerId=… and the callback.
 *
 * GRACEFUL: when no SSO_* env is set, this is a no-op and SSO is absent. The
 * config shapes mirror the plugin's OIDCConfig / SAMLConfig (stored as JSON
 * strings, exactly as the plugin serializes them).
 *
 * Cannot be exercised against a real IdP here — flag for live Okta/Entra testing.
 */

export interface SsoProviderInfo {
  providerId: string;
  type: "oidc" | "saml";
  domain: string;
  label: string;
}

/** Is an OIDC provider fully configured via env? */
export function hasOidcConfig(): boolean {
  return Boolean(
    env.SSO_OIDC_PROVIDER_ID &&
      env.SSO_OIDC_ISSUER &&
      env.SSO_OIDC_CLIENT_ID &&
      env.SSO_OIDC_CLIENT_SECRET &&
      env.SSO_OIDC_DOMAIN,
  );
}

/** Is a SAML provider fully configured via env? */
export function hasSamlConfig(): boolean {
  return Boolean(
    env.SSO_SAML_PROVIDER_ID &&
      env.SSO_SAML_ISSUER &&
      env.SSO_SAML_ENTRY_POINT &&
      env.SSO_SAML_CERT &&
      env.SSO_SAML_DOMAIN,
  );
}

/** The configured providers, for rendering SSO buttons on the login page. */
export function configuredSsoProviders(): SsoProviderInfo[] {
  const out: SsoProviderInfo[] = [];
  if (hasOidcConfig()) {
    out.push({
      providerId: env.SSO_OIDC_PROVIDER_ID!,
      type: "oidc",
      domain: env.SSO_OIDC_DOMAIN!,
      label: "Continue with SSO",
    });
  }
  if (hasSamlConfig()) {
    out.push({
      providerId: env.SSO_SAML_PROVIDER_ID!,
      type: "saml",
      domain: env.SSO_SAML_DOMAIN!,
      label: "Continue with SAML SSO",
    });
  }
  return out;
}

function spBaseUrl(): string {
  return `${env.APP_URL}/api/auth`;
}

let seeded = false;

/**
 * Idempotently upsert env-configured SSO providers into the SsoProvider table.
 * Safe to call repeatedly (memoized per process). No-op when nothing configured
 * or when the DB is unreachable (logged, swallowed — never blocks a request).
 */
export async function ensureSsoProviders(): Promise<void> {
  if (seeded) return;
  if (!hasOidcConfig() && !hasSamlConfig()) {
    seeded = true;
    return;
  }

  try {
    if (hasOidcConfig()) {
      const providerId = env.SSO_OIDC_PROVIDER_ID!;
      const issuer = env.SSO_OIDC_ISSUER!;
      const oidcConfig = JSON.stringify({
        issuer,
        pkce: true,
        clientId: env.SSO_OIDC_CLIENT_ID,
        clientSecret: env.SSO_OIDC_CLIENT_SECRET,
        // Standard OIDC discovery document location; the plugin hydrates the
        // endpoints from here at sign-in time.
        discoveryEndpoint: `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
        scopes: ["openid", "email", "profile"],
        mapping: { id: "sub", email: "email", name: "name" },
      });
      await prisma.ssoProvider.upsert({
        where: { providerId },
        create: {
          providerId,
          issuer,
          domain: env.SSO_OIDC_DOMAIN!,
          oidcConfig,
        },
        update: { issuer, domain: env.SSO_OIDC_DOMAIN!, oidcConfig },
      });
    }

    if (hasSamlConfig()) {
      const providerId = env.SSO_SAML_PROVIDER_ID!;
      const issuer = env.SSO_SAML_ISSUER!;
      const samlConfig = JSON.stringify({
        issuer,
        entryPoint: env.SSO_SAML_ENTRY_POINT,
        cert: env.SSO_SAML_CERT,
        callbackUrl: `${spBaseUrl()}/sso/saml2/callback/${providerId}`,
        // Service-provider metadata for the IdP side.
        spMetadata: {
          metadata: "",
          entityID: `${spBaseUrl()}/sso/saml2/sp/metadata?providerId=${providerId}`,
        },
        idpMetadata: {
          entityID: issuer,
          singleSignOnService: [
            { Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect", Location: env.SSO_SAML_ENTRY_POINT },
          ],
          cert: env.SSO_SAML_CERT,
        },
        mapping: { id: "nameID", email: "email", name: "displayName" },
      });
      await prisma.ssoProvider.upsert({
        where: { providerId },
        create: {
          providerId,
          issuer,
          domain: env.SSO_SAML_DOMAIN!,
          samlConfig,
        },
        update: { issuer, domain: env.SSO_SAML_DOMAIN!, samlConfig },
      });
    }

    seeded = true;
  } catch (err) {
    // DB not ready / migration not applied yet — don't crash boot. The login
    // page degrades to no SSO buttons; retry on next call.
    console.error("[sso] failed to seed SSO providers from env:", err);
  }
}
