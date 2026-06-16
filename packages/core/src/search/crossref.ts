import { Prisma, type PrismaClient } from "@forgespecs/db";

/**
 * Cross-reference / impact analysis over the Dependency graph using a recursive
 * CTE. Two directions:
 *  - OUTGOING ("what does X depend on / reference"): follow from→to.
 *  - INCOMING ("what references X / impact of changing X"): follow to→from.
 *
 * The transitive closure is computed in Postgres (set-based, cycle-safe via a
 * visited-path guard) rather than N round-trips. Both the seed id and depth are
 * bound parameters; `direction` selects between two fixed, code-controlled SQL
 * templates (never interpolated from user input).
 *
 * RBAC: callers pass the seed document only after a `doc.read` check, and the
 * closure is intersected with the reader's allow-list at the call site
 * (route/action) — dependencies can cross projects, so the closure itself is
 * unfiltered and the API layer trims it to readable docs.
 */

export type CrossRefDirection = "incoming" | "outgoing";

export interface CrossRefEdge {
  fromDocId: string;
  toDocId: string;
  kind: string;
  /** Hops from the seed (1 = direct neighbor). */
  depth: number;
}

/**
 * Transitive closure of dependencies from `documentId`.
 *
 * @param direction "outgoing" = docs this one points at (its dependencies);
 *                  "incoming" = docs that point at this one (its dependents /
 *                  blast radius).
 * @param maxDepth  hop limit (default 6) to bound runaway graphs.
 */
export async function dependencyClosure(
  prisma: PrismaClient,
  params: {
    documentId: string;
    direction: CrossRefDirection;
    maxDepth?: number;
  },
): Promise<CrossRefEdge[]> {
  const { documentId, direction, maxDepth = 6 } = params;

  // Two fixed templates. The recursive step walks the chosen edge orientation
  // and the WHERE NOT (... = ANY(path)) clause prevents cycling forever.
  const sql =
    direction === "outgoing"
      ? Prisma.sql`
          WITH RECURSIVE closure AS (
            SELECT
              dep."fromDocId",
              dep."toDocId",
              dep."kind"::text AS "kind",
              1 AS depth,
              ARRAY[dep."fromDocId", dep."toDocId"] AS path
            FROM "dependency" dep
            WHERE dep."fromDocId" = ${documentId}

            UNION ALL

            SELECT
              dep."fromDocId",
              dep."toDocId",
              dep."kind"::text AS "kind",
              c.depth + 1,
              c.path || dep."toDocId"
            FROM "dependency" dep
            JOIN closure c ON dep."fromDocId" = c."toDocId"
            WHERE c.depth < ${maxDepth}
              AND NOT (dep."toDocId" = ANY(c.path))
          )
          SELECT DISTINCT "fromDocId", "toDocId", "kind", depth
          FROM closure
          ORDER BY depth ASC
        `
      : Prisma.sql`
          WITH RECURSIVE closure AS (
            SELECT
              dep."fromDocId",
              dep."toDocId",
              dep."kind"::text AS "kind",
              1 AS depth,
              ARRAY[dep."toDocId", dep."fromDocId"] AS path
            FROM "dependency" dep
            WHERE dep."toDocId" = ${documentId}

            UNION ALL

            SELECT
              dep."fromDocId",
              dep."toDocId",
              dep."kind"::text AS "kind",
              c.depth + 1,
              c.path || dep."fromDocId"
            FROM "dependency" dep
            JOIN closure c ON dep."toDocId" = c."fromDocId"
            WHERE c.depth < ${maxDepth}
              AND NOT (dep."fromDocId" = ANY(c.path))
          )
          SELECT DISTINCT "fromDocId", "toDocId", "kind", depth
          FROM closure
          ORDER BY depth ASC
        `;

  const rows = await prisma.$queryRaw<
    { fromDocId: string; toDocId: string; kind: string; depth: number }[]
  >(sql);

  return rows.map((r) => ({
    fromDocId: r.fromDocId,
    toDocId: r.toDocId,
    kind: r.kind,
    depth: Number(r.depth),
  }));
}

/**
 * Distinct set of document ids reachable from the seed in the given direction
 * (excluding the seed itself). Convenience for the API layer to intersect with
 * the reader's allow-list and then hydrate titles.
 */
export function reachableDocIds(
  edges: CrossRefEdge[],
  direction: CrossRefDirection,
): string[] {
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(direction === "outgoing" ? e.toDocId : e.fromDocId);
  }
  return [...ids];
}
