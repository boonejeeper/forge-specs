import { configuredSsoProviders, ensureSsoProviders } from "@/lib/auth/sso";
import { LoginForm, type SsoButton } from "./login-form";

/**
 * Login page (server component). Seeds env-configured SSO providers into the DB
 * (idempotent) and passes the available SSO buttons to the client form. When no
 * SSO_* env is set, no SSO buttons render — SSO is gracefully absent.
 */
export default async function LoginPage() {
  // Best-effort: ensure provider rows exist so /sign-in/sso?providerId resolves.
  await ensureSsoProviders();
  const ssoProviders: SsoButton[] = configuredSsoProviders().map((p) => ({
    providerId: p.providerId,
    label: p.label,
  }));

  return <LoginForm ssoProviders={ssoProviders} />;
}
