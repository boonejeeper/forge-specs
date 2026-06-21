---
title: Import from a repo
order: 2
---

# Import from a repo

The fastest way to bootstrap a project: point ForgeSpecs at a repository, and it will (a) verbatim-import every `*.md` / `*.mdx` / `README` it finds, and (b) ask the AI to synthesize the canonical ForgeSpecs taxonomy (Vision, PRDs, RFCs, ADRs, API_SPEC, DB_SCHEMA, RUNBOOK) from the code summaries + verbatim docs.

## Where ForgeSpecs can read from

In v1, three source kinds are supported:

- **Local filesystem path** — for self-hosters who run ForgeSpecs alongside the repo. Path must resolve under one of `INGEST_LOCAL_ALLOWED_ROOTS` (set in `.env`). The default Docker setup mounts the workspace repo at `/repo` read-only, so `INGEST_LOCAL_ALLOWED_ROOTS=/repo` works out of the box.
- **Public GitHub repo** — paste an `owner/repo` ref; no token needed.
- **Private GitHub repo with a PAT** — paste an `owner/repo` ref and a fine-grained personal access token (read-only). The token is encrypted at rest with AES-256-GCM (key derived from `BETTER_AUTH_SECRET`) and is never returned by any API.

## Running an ingest

1. Open the project, click "Import from a repo" on the empty-state card (or hit `/${ws}/${proj}/ingest` directly).
2. Pick a source kind. For local, type the absolute path. For GitHub, paste `owner/repo` and optionally a branch + PAT.
3. Click "Start ingest". A `GenerationJob` is created and the panel shows live stage progress: **fetch → walk → verbatim → summarize → synthesize → finalize**.
4. When it finishes, the project tree fills with documents. Re-running on the same repo is idempotent — unchanged files are skipped, changed files become a new `DocumentVersion`, deleted files mark their docs `DEPRECATED`.

If `OPENROUTER_API_KEY` is unset on the server, the verbatim pass still runs (no AI needed) and the synthesis pass is skipped with a banner pointing at env setup.

## PAT permissions

For private GitHub repos, the ingest only ever does GET requests, so a read-only PAT is sufficient.

**Fine-grained PAT (recommended):**

- Repository access: **Only select repositories** → pick the ones you want ingestable.
- Repository permissions:
  - **Contents** → Read-only
  - **Metadata** → Read-only (granted automatically when you grant any other permission)
- No other permissions, no organization permissions, no account permissions.

**Classic PAT (if you must):**

- Public repos only → `public_repo` scope.
- Private repos → `repo` scope (broader than needed, but it's the only read option in classic PATs).

The PAT is stored on `RepoIngestSource.tokenCipher` as AES-256-GCM ciphertext (key derived from `BETTER_AUTH_SECRET` via HKDF-SHA256). Decryption happens only inside the worker process at fetch time. The plaintext never round-trips back through any API.

## Local-path mode

For local mode, set `INGEST_LOCAL_ALLOWED_ROOTS` to a CSV of absolute paths the server is allowed to ingest from. The path the user submits must resolve (via `realpath`) under one of those roots — symlinks pointing outside the allowlist are rejected.

In the bundled `docker-compose.yml`, the `app` service mounts the workspace repo at `/repo:ro` and sets `INGEST_LOCAL_ALLOWED_ROOTS=/repo`. So `docker compose up --build` + "Import from a repo" with path `/repo` works out of the box.

## What gets imported

- `*.md`, `*.mdx`, `*.markdown` files → `DOC` files, imported verbatim as one `Document` per file. The path is stored as `Document.sourcePath` so re-runs dedupe on it; type is guessed from the path (`docs/adr/*` → `ADR`, `docs/rfcs/*` → `RFC`, etc.).
- Source code files (`*.ts`, `*.py`, `*.go`, etc.) → `CODE` files. The fast AI model produces a short structured summary per file (purpose / public surface / deps) into `RepoFile.summary`.
- Configuration / build files (`*.json`, `*.yaml`, `Dockerfile`) → `CONFIG`, kept in the manifest, not summarized.
- Binary or oversized files (>1 MiB) → `BINARY_SKIPPED`, kept in the manifest with a placeholder sha.
- `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.turbo`, lockfiles, etc. → skipped entirely.

The synthesis pass then reads the verbatim docs + the per-file summaries and emits the canonical taxonomy as new documents with stable `auto-*` slugs (so re-runs upsert in place). Each synthesized doc is linked back to the verbatim docs it grounded in via a `DERIVES_FROM` dependency edge — visible on the graph view.
