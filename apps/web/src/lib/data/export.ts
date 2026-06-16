import "server-only";

import { prisma, DocumentType, type DocumentStatus, type Prisma } from "@forgespecs/db";
import {
  dependencyClosure,
  reachableDocIds,
  readableDocumentIds,
} from "@forgespecs/core/search";
import {
  extractOpenApiSpec,
  extractErdSource,
  parseDbml,
  parseMermaidErd,
  generateDbml,
} from "@forgespecs/core/graph";
import { dbmlToSql } from "@forgespecs/core/graph/export";
import {
  extractAcceptanceCriteria,
  type ExportDocument,
  type ExportFrontmatter,
} from "@forgespecs/core/export";

import { currentUserId } from "@/lib/data/workspaces";

/**
 * Loaders that assemble the impure inputs for the pure export serializers:
 *  - RBAC (readable allow-list),
 *  - dependency closure via the crossref recursive CTE,
 *  - M9 OpenAPI / DBML extraction for API_SPEC / DB_SCHEMA docs.
 *
 * The serializers (@forgespecs/core/export) are pure + unit-tested; everything
 * impure lives here so the route handlers stay thin.
 */

interface DocRow {
  id: string;
  slug: string;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
  frontmatter: Prisma.JsonValue;
  contentJSON: Prisma.JsonValue;
}

const DOC_SELECT = {
  id: true,
  slug: true,
  title: true,
  type: true,
  status: true,
  frontmatter: true,
  contentJSON: true,
} as const;

/** Turn a raw document row into an ExportDocument (acceptance criteria + extracted payloads). */
function toExportDocument(row: DocRow): ExportDocument {
  const frontmatter = (row.frontmatter as ExportFrontmatter) ?? {};
  const acceptanceCriteria = extractAcceptanceCriteria(row.contentJSON);

  const out: ExportDocument = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    status: row.status,
    frontmatter,
    contentJSON: row.contentJSON ?? [],
    acceptanceCriteria,
  };

  if (row.type === DocumentType.API_SPEC) {
    const api = extractOpenApiSpec(row.contentJSON);
    out.openapi = api ? { source: api.source, format: api.format } : null;
  }
  if (row.type === DocumentType.DB_SCHEMA) {
    const erd = extractErdSource(row.contentJSON);
    if (erd) {
      // Normalize to DBML (the canonical serialization) + generated SQL.
      const model = erd.format === "dbml" ? parseDbml(erd.source) : parseMermaidErd(erd.source);
      const dbml = erd.format === "dbml" ? erd.source : generateDbml(model);
      let sql: string | undefined;
      try {
        sql = dbmlToSql(dbml, "postgres");
      } catch {
        sql = undefined; // malformed DBML → omit SQL rather than fail the export
      }
      out.dbml = { source: dbml, sql };
    } else {
      out.dbml = null;
    }
  }

  return out;
}

export interface DocumentExportData {
  seed: ExportDocument;
  /** The dependency closure (outgoing) members, readable + ordered by depth. */
  closure: ExportDocument[];
}

/**
 * Load a document plus its outgoing dependency closure for export. Returns null
 * when the seed is not readable by the current user. The closure is trimmed to
 * the reader's allow-list (dependencies can cross projects).
 */
export async function getDocumentExportData(
  documentId: string,
): Promise<DocumentExportData | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const allowed = new Set(await readableDocumentIds(prisma, { userId }));
  if (!allowed.has(documentId)) return null;

  const edges = await dependencyClosure(prisma, { documentId, direction: "outgoing" });
  const closureIds = reachableDocIds(edges, "outgoing").filter((id) => allowed.has(id));
  // shallowest depth per doc for ordering
  const depthById = new Map<string, number>();
  for (const e of edges) {
    const prev = depthById.get(e.toDocId);
    if (prev === undefined || e.depth < prev) depthById.set(e.toDocId, e.depth);
  }

  const rows = await prisma.document.findMany({
    where: { id: { in: [documentId, ...closureIds] } },
    select: DOC_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const seedRow = byId.get(documentId);
  if (!seedRow) return null;

  const closure = closureIds
    .map((id) => byId.get(id))
    .filter((r): r is DocRow => r !== undefined)
    .sort((a, b) => (depthById.get(a.id) ?? 0) - (depthById.get(b.id) ?? 0))
    .map(toExportDocument);

  return { seed: toExportDocument(seedRow), closure };
}

/**
 * Load a set of documents (by id) + their combined outgoing dependency closure,
 * for an agent bundle. Roots come first (input order), then closure members not
 * already in the root set, ordered by depth. RBAC-trimmed to the reader.
 */
export async function getBundleExportData(
  rootDocumentIds: string[],
): Promise<ExportDocument[] | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const allowed = new Set(await readableDocumentIds(prisma, { userId }));
  const roots = rootDocumentIds.filter((id) => allowed.has(id));
  if (roots.length === 0) return [];

  // Union of each root's outgoing closure.
  const depthById = new Map<string, number>();
  await Promise.all(
    roots.map(async (id) => {
      const edges = await dependencyClosure(prisma, { documentId: id, direction: "outgoing" });
      for (const e of edges) {
        if (!allowed.has(e.toDocId)) continue;
        const prev = depthById.get(e.toDocId);
        if (prev === undefined || e.depth < prev) depthById.set(e.toDocId, e.depth);
      }
    }),
  );

  const rootSet = new Set(roots);
  const closureIds = [...depthById.keys()].filter((id) => !rootSet.has(id));

  const rows = await prisma.document.findMany({
    where: { id: { in: [...roots, ...closureIds] } },
    select: DOC_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const ordered: DocRow[] = [];
  for (const id of roots) {
    const r = byId.get(id);
    if (r) ordered.push(r);
  }
  for (const id of closureIds.sort((a, b) => (depthById.get(a) ?? 0) - (depthById.get(b) ?? 0))) {
    const r = byId.get(id);
    if (r) ordered.push(r);
  }

  return ordered.map(toExportDocument);
}
