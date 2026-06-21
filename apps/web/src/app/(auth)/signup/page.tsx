import { configuredSsoProviders, ensureSsoProviders } from "@/lib/auth/sso";
import type { SsoButton } from "../login/login-form";
import { SignupForm } from "./signup-form";

/**
 * Signup page (server component). Mirrors the login page: seeds env-configured
 * SSO providers (idempotent) and passes available SSO buttons to the client form.
 */
export default async function SignupPage() {
  await ensureSsoProviders();
  const ssoProviders: SsoButton[] = configuredSsoProviders().map((p) => ({
    providerId: p.providerId,
    label: p.label,
  }));

  return <SignupForm ssoProviders={ssoProviders} />;
}
