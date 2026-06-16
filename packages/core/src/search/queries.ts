import { Prisma, type PrismaClient } from "@forgespecs/db";
import { SEARCH_HL_START, SEARCH_HL_END } from "@forgespecs/config";

/**
 * Raw-SQL query builders for the two retrieval legs of hybrid search:
 *  - full-text over Document.searchVector (websearch_to_tsquery + ts_rank_cd)
 *  - semantic over Embedding.embedding (pgvector cosine `<=>`)
 *
 * Both are parameterized through Prisma's tagged-template `$queryRaw` (every
 * interpolation is a bound parameter, never string-concatenated SQL) and both
 * filter to an explicit allow-list of document ids resolved from RBAC. There is
 * no path by which a caller-supplied string reaches the query as raw SQL.
 *
 * Postgres is not running at build time, so these are not executed in tests; the
 * pure ranking/fusion logic is unit-tested separately and the SQL is written to
 * match the columns/indexes created in M0's migration (GIN on searchVector,
 * HNSW vector_cosine_ops on embedding).
 */

/**
 * Sentinel tokens wrapping highlighted terms in ts_headline output. We do NOT
 * use HTML tags as the StartSel/StopSel because ts_headline does not escape the
 * underlying (user-authored) document text — emitting HTML would be an XSS sink.
 * Instead we wrap matches in these unlikely-to-collide markers and let the UI
 * split on them to render <mark> safely from plain text.
 */
export const HL_START = SEARCH_HL_START;
export const HL_END = SEARCH_HL_END;

export interface FullTextHit {
  documentId: string;
  rank: number;
  /**
   * Plain-text snippet around the match. Matched terms are wrapped in the
   * HL_START / HL_END sentinels (NOT HTML) so the client can render highlights
   * without trusting document content as markup.
   */
  snippet: string;
}

export interface SemanticHit {
  documentId: string;
  blockId: string | null;
  chunkIndex: number;
  /** Cosine distance (0 = identical). Lower is better. */
  distance: number;
  content: string;
}

/**
 * Full-text search over the maintained tsvector. `websearch_to_tsquery` accepts
 * Google-style operators ("a b", "a OR b", -exclude, "quoted phrase") and is
 * injection-safe by construction — the user string is a single bound parameter
 * parsed by Postgres, never SQL. Empty allow-list → [] without touching the DB.
 */
export async function fullTextSearch(
  prisma: PrismaClient,
  params: {
    query: string;
    documentIds: string[];
    limit?: number;
  },
): Promise<FullTextHit[]> {
  const { query, documentIds, limit = 20 } = params;
  if (documentIds.length === 0 || !query.trim()) return [];

  const ids = Prisma.join(documentIds);

  const rows = await prisma.$queryRaw<
    { documentId: string; rank: number; snippet: string }[]
  >`
    SELECT
      d."id" AS "documentId",
      ts_rank_cd(d."searchVector", websearch_to_tsquery('english', ${query})) AS "rank",
      ts_headline(
        'english',
        coalesce(d."title", '') || ' — ' || coalesce(d."contentText", ''),
        websearch_to_tsquery('english', ${query}),
        'StartSel=' || ${HL_START} || ', StopSel=' || ${HL_END} || ', MaxFragments=2, MaxWords=24, MinWords=8, HighlightAll=FALSE'
      ) AS "snippet"
    FROM "document" d
    WHERE d."id" IN (${ids})
      AND d."searchVector" @@ websearch_to_tsquery('english', ${query})
    ORDER BY "rank" DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    documentId: r.documentId,
    rank: Number(r.rank),
    snippet: r.snippet,
  }));
}

/**
 * Semantic search via pgvector cosine distance. The query embedding is bound as
 * a parameter and cast to `::vector` (the `<=>` operator + HNSW index require
 * the vector type). We return per-chunk hits and let the caller collapse to best
 * chunk per document. The embedding is passed as a JSON-ish array literal string
 * — pgvector accepts `'[1,2,3]'::vector`.
 */
export async function semanticSearch(
  prisma: PrismaClient,
  params: {
    embedding: number[];
    documentIds: string[];
    /** Restrict to a single embedding model (dimension safety). */
    model?: string;
    limit?: number;
  },
): Promise<SemanticHit[]> {
  const { embedding, documentIds, model, limit = 40 } = params;
  if (documentIds.length === 0 || embedding.length === 0) return [];

  const ids = Prisma.join(documentIds);
  // pgvector's text input format is "[v1,v2,...]". Numbers are sanitized via
  // Number() so only finite numerics reach the literal; it is still bound as a
  // parameter and cast server-side.
  const vectorLiteral = `[${embedding.map((n) => Number(n)).join(",")}]`;

  const modelClause = model
    ? Prisma.sql`AND e."model" = ${model}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    {
      documentId: string;
      blockId: string | null;
      chunkIndex: number;
      distance: number;
      content: string;
    }[]
  >`
    SELECT
      e."documentId" AS "documentId",
      e."blockId" AS "blockId",
      e."chunkIndex" AS "chunkIndex",
      (e."embedding" <=> ${vectorLiteral}::vector) AS "distance",
      e."content" AS "content"
    FROM "embedding" e
    WHERE e."documentId" IN (${ids})
      AND e."embedding" IS NOT NULL
      ${modelClause}
    ORDER BY e."embedding" <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    documentId: r.documentId,
    blockId: r.blockId,
    chunkIndex: Number(r.chunkIndex),
    distance: Number(r.distance),
    content: r.content,
  }));
}

/**
 * Collapse per-chunk semantic hits to one hit per document (the closest chunk),
 * preserving the cosine ordering. The first occurrence of a documentId in the
 * distance-sorted input is its best chunk.
 */
export function bestChunkPerDocument(hits: SemanticHit[]): SemanticHit[] {
  const seen = new Set<string>();
  const out: SemanticHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.documentId)) continue;
    seen.add(hit.documentId);
    out.push(hit);
  }
  return out;
}
