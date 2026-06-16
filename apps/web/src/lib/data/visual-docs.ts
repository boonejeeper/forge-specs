import "server-only";

import { prisma, DocumentType } from "@forgespecs/db";
import {
  extractOpenApiSpec,
  extractErdSource,
  parseDbml,
  parseMermaidErd,
  generateDbml,
  type ErdModel,
  type ExtractedOpenApi,
} from "@forgespecs/core/graph";
import { readableDocumentIds } from "@forgespecs/core/search";

import { currentUserId } from "@/lib/data/workspaces";

/**
 * Data functions for the ERD designer + OpenAPI explorer. They read a document's
 * projected BlockNote content (contentJSON) and pull out the structured payload:
 *  - DB_SCHEMA docs → a normalized ERD table model (from a DBML block, else the
 *    Mermaid erDiagram block M7 seeds).
 *  - API_SPEC docs → an OpenAPI spec object + raw source for Scalar.
 *
 * RBAC: every fn checks the doc is in the reader's allow-list before returning.
 */

async function readableContent(
  documentId: string,
): Promise<{ type: DocumentType; title: string; contentJSON: unknown } | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const allowed = new Set(await readableDocumentIds(prisma, { userId }));
  if (!allowed.has(documentId)) return null;
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { type: true, title: true, contentJSON: true },
  });
  if (!doc) return null;
  return { type: doc.type, title: doc.title, contentJSON: doc.contentJSON ?? null };
}

export interface ErdDocData {
  documentId: string;
  title: string;
  /** "dbml" | "mermaid" — which block we parsed. */
  format: "dbml" | "mermaid";
  /** Normalized table model the ERD designer renders + edits. */
  model: ErdModel;
  /** Canonical DBML serialization (regenerated from the model). */
  dbml: string;
}

/** Pull the ERD table model out of a DB_SCHEMA document. */
export async function getErdForDocument(
  documentId: string,
): Promise<ErdDocData | null> {
  const doc = await readableContent(documentId);
  if (!doc) return null;

  const src = extractErdSource(doc.contentJSON);
  if (!src) return null;

  const model =
    src.format === "dbml" ? parseDbml(src.source) : parseMermaidErd(src.source);

  return {
    documentId,
    title: doc.title,
    format: src.format,
    model,
    dbml: generateDbml(model),
  };
}

export interface OpenApiDocData {
  documentId: string;
  title: string;
  spec: ExtractedOpenApi["spec"];
  source: string;
  format: ExtractedOpenApi["format"];
}

/** Pull + parse the OpenAPI spec out of an API_SPEC document. */
export async function getOpenApiForDocument(
  documentId: string,
): Promise<OpenApiDocData | null> {
  const doc = await readableContent(documentId);
  if (!doc) return null;

  const extracted = extractOpenApiSpec(doc.contentJSON);
  if (!extracted) return null;

  return {
    documentId,
    title: doc.title,
    spec: extracted.spec,
    source: extracted.source,
    format: extracted.format,
  };
}

export interface VisualDocRef {
  id: string;
  title: string;
  slug: string;
}

/** List a project's DB_SCHEMA documents (for the project schema overview). */
export async function listSchemaDocs(projectId: string): Promise<VisualDocRef[]> {
  return listDocsOfType(projectId, DocumentType.DB_SCHEMA);
}

/** List a project's API_SPEC documents (for the project API overview). */
export async function listApiDocs(projectId: string): Promise<VisualDocRef[]> {
  return listDocsOfType(projectId, DocumentType.API_SPEC);
}

async function listDocsOfType(
  projectId: string,
  type: DocumentType,
): Promise<VisualDocRef[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const allowed = new Set(
    await readableDocumentIds(prisma, { userId, projectId }),
  );
  const docs = await prisma.document.findMany({
    where: { projectId, type },
    orderBy: { title: "asc" },
    select: { id: true, title: true, slug: true },
  });
  return docs.filter((d) => allowed.has(d.id));
}
