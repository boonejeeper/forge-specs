# ForgeSpecs

A self-hostable, AI-native RFC & architecture spec platform: idea → PRD → RFCs →
ADRs → API contracts → DB schemas → implementation plans — generated and
maintained with AI agents, with governance, collaboration, versioning, and
traceability.

> **Status: M0 — Foundation.** Monorepo, database schema, auth, RBAC, and the
> Next.js app shell are in place. Editor, search, realtime collab, and AI flows
> arrive in later milestones.

## Stack

- **Monorepo:** pnpm workspace + Turborepo
- **Web:** Next.js 15 (App Router) + TypeScript + Tailwind v4 + shadcn/ui +
  TanStack Query + Zustand
- **DB:** Postgres + pgvector via Prisma
- **Auth:** Better Auth (email/password, GitHub, Google)
- **AI (later):** OpenRouter via the Vercel AI SDK
- **Realtime (later):** separate `collab` process (Yjs + websockets)

## Layout

```
forgespecs/
  docker-compose.yml
  packages/
    config/   zod-validated env + shared constants
    db/       Prisma schema, singleton client, raw SQL migration
    core/     domain logic — RBAC chokepoint (more in later milestones)
  apps/
    web/      Next.js 15 App Router
    collab/   Yjs websocket server (stub in M0, full impl in M4)
```

Scoped package names: `@forgespecs/config`, `@forgespecs/db`, `@forgespecs/core`,
`@forgespecs/collab`, and `web`.

## Prerequisites

- Node 22+ (`.nvmrc` pins 22)
- pnpm 11+
- Docker (for Postgres/Redis)

## Getting started

```bash
# 1. Install
pnpm install

# 2. Configure env
cp .env.example .env   # then fill in secrets (OpenRouter key, OAuth, etc.)

# 3. Start infra (Postgres + Redis)
docker compose up -d postgres redis

# 4. Apply the schema + raw SQL (extensions, HNSW, tsvector trigger, GIN)
pnpm --filter @forgespecs/db exec prisma migrate deploy
#   (or, for the very first bootstrap against a fresh DB:)
#   pnpm --filter @forgespecs/db exec prisma db push
#   psql "$DATABASE_URL" -f packages/db/prisma/migrations/00000000000001_init_extensions_search/migration.sql

# 5. Generate the Prisma client
pnpm --filter @forgespecs/db exec prisma generate

# 6. Run the web app
pnpm --filter web dev      # http://localhost:3000
```

### Full docker-compose

```bash
docker compose up --build     # app :3000, collab :1234, postgres, redis
```

## Scripts

| Command | What |
|---|---|
| `pnpm -r typecheck` | Type-check every package (`tsc --noEmit`) |
| `pnpm -r test` | Run unit tests (Vitest) |
| `pnpm --filter web build` | Production Next.js build |
| `pnpm db:validate` | `prisma validate` (needs `DATABASE_URL`) |
| `pnpm db:generate` | `prisma generate` (no DB needed) |

> `prisma validate` reads `DATABASE_URL`. For local convenience the db package
> picks up the root `.env` via `packages/db/.env` (a symlink to `../../.env`,
> gitignored). `prisma generate` does **not** require the DB and runs in Docker
> builds without it.

## Conventions

- **Three sources of truth, never conflated:** convergent content → Yjs;
  queryable server facts → Postgres + TanStack Query; ephemeral UI → Zustand.
- **One RBAC chokepoint:** `requirePermission()` / `withPermission()` in
  `@forgespecs/core`, reused by Server Actions and (later) the collab handshake.
- **Query keys** live in `apps/web/src/lib/query/keys.ts` — the single source for
  cache invalidation.
- **Keyboard shortcuts** live in one registry
  (`apps/web/src/lib/keyboard/registry.ts`); the command palette is generated
  from it.
