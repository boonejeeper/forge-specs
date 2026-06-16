-- ForgeSpecs — hand-written migration for capabilities Prisma cannot express:
--   1. pgvector + pg_trgm extensions
--   2. HNSW index on Embedding.embedding (vector_cosine_ops)
--   3. tsvector trigger maintaining Document.searchVector over (title || contentText)
--   4. GIN index on the search vector
--
-- APPLY ORDER: this migration must run AFTER the Prisma-generated migration that
-- creates the base tables/columns (`document`, `embedding`, including the
-- `searchVector` tsvector column and `embedding vector(1536)` column).
--
-- Because the schema declares these columns via Unsupported(...), `prisma migrate
-- dev` will scaffold the `vector(1536)` and `tsvector` columns itself; this file
-- adds only the extension creation, indexes, and trigger that Prisma cannot model.
--
-- Manual apply (no live DB needed for M0):
--   psql "$DATABASE_URL" -f prisma/migrations/00000000000001_init_extensions_search/migration.sql
-- or, once the DB is up:
--   pnpm --filter @forgespecs/db exec prisma migrate deploy

-- ── 1. Extensions ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. HNSW index on embeddings (cosine distance) ──────────────────────────
-- Defensive: ensure the column exists if a fresh DB is being bootstrapped from
-- this file alone before the Prisma migration has run.
ALTER TABLE "embedding"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

CREATE INDEX IF NOT EXISTS "embedding_embedding_hnsw_idx"
  ON "embedding"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 3. tsvector column + trigger over (title || contentText) ───────────────
ALTER TABLE "document"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE OR REPLACE FUNCTION document_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."contentText", '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_search_vector_trigger ON "document";
CREATE TRIGGER document_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "title", "contentText"
  ON "document"
  FOR EACH ROW
  EXECUTE FUNCTION document_search_vector_update();

-- Backfill any existing rows.
UPDATE "document"
  SET "searchVector" =
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("contentText", '')), 'B');

-- ── 4. GIN index on the search vector ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS "document_search_vector_gin_idx"
  ON "document"
  USING gin ("searchVector");

-- ── Bonus: pg_trgm GIN index for fuzzy title matching (used by palette later) ─
CREATE INDEX IF NOT EXISTS "document_title_trgm_idx"
  ON "document"
  USING gin ("title" gin_trgm_ops);
