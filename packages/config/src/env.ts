import { z } from "zod";

/**
 * Single source of truth for environment configuration.
 *
 * Parsed once at module load. Importing `env` from anywhere in the monorepo
 * guarantees the value is present and correctly typed, or the process fails
 * fast at startup with a readable error.
 *
 * NOTE: This intentionally validates the union of variables used across the
 * web app and the collab process. Variables that are only relevant in the
 * browser are NOT included here — this module is server-only.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Database (Postgres + pgvector)
  DATABASE_URL: z.string().url(),

  // AI — OpenRouter (provider-agnostic gateway)
  OPENROUTER_API_KEY: z.string().min(1),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(1),

  // OAuth providers
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // App URL — public base URL of the web app
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Collab (Yjs websocket server)
  COLLAB_PORT: z.coerce.number().int().positive().default(1234),

  // Redis (BullMQ jobs / rate limit / collab backplane). OPTIONAL — when unset,
  // background jobs run inline, rate limiting uses an in-memory bucket, and the
  // collab backplane no-ops to single-replica. Intentionally NO default: a
  // default would make isRedisEnabled() true everywhere (incl. `next build`),
  // causing eager ioredis ECONNREFUSED spam when no Redis is running.
  REDIS_URL: z.string().url().optional(),

  // OIDC/SAML SSO (Better Auth @better-auth/sso) — all OPTIONAL so the app
  // builds and runs with no IdP configured. When SSO_OIDC_* (or SSO_SAML_*) are
  // present a provider is registered at boot; otherwise SSO is gracefully absent.
  SSO_OIDC_PROVIDER_ID: z.string().min(1).optional(),
  SSO_OIDC_ISSUER: z.string().url().optional(),
  SSO_OIDC_CLIENT_ID: z.string().min(1).optional(),
  SSO_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  SSO_OIDC_DOMAIN: z.string().min(1).optional(),
  // SAML: an XML metadata blob (or URL) for the IdP. Fiddly + IdP-specific, so
  // it is fully configuration-driven and absent when unset.
  SSO_SAML_PROVIDER_ID: z.string().min(1).optional(),
  SSO_SAML_ISSUER: z.string().min(1).optional(),
  SSO_SAML_ENTRY_POINT: z.string().url().optional(),
  SSO_SAML_CERT: z.string().min(1).optional(),
  SSO_SAML_DOMAIN: z.string().min(1).optional(),

  // GitHub PR linkage webhook — OPTIONAL. When set, /api/webhooks/github
  // verifies the HMAC signature and reflects PR status onto linked docs/tasks.
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Collab Redis backplane (multi-replica awareness/update fan-out). Defaults to
  // off; only meaningful with REDIS_URL set AND multiple collab replicas.
  COLLAB_REDIS_BACKPLANE: z
    .enum(["0", "1", "true", "false"])
    .optional(),

  // Repo ingest (M12). CSV of absolute paths under which a LOCAL ingest is
  // allowed. Empty → local mode disabled (the form hides it). Symlinks that
  // escape the allowlist are rejected at resolve time. INGEST_MAX_BYTES caps
  // an aggregate download/walk; rejects above this size with a clear error.
  INGEST_LOCAL_ALLOWED_ROOTS: z.string().optional(),
  INGEST_MAX_BYTES: z.coerce.number().int().positive().default(104_857_600),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Lazily-validated env. We parse against `process.env` at first access so that
 * tooling (e.g. `prisma generate`, type-checking) that imports the package
 * without a populated environment does not crash at import time.
 */
let cached: Env | undefined;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `See .env.example for the required variables.`,
    );
  }
  return parsed.data;
}

/**
 * Typed, validated environment. Access triggers validation on first use.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!cached) cached = parseEnv();
    return cached[prop as keyof Env];
  },
});

/** Force validation now (e.g. at server boot) and return the parsed env. */
export function loadEnv(): Env {
  if (!cached) cached = parseEnv();
  return cached;
}
