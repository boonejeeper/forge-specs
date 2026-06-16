"use server";

import { prisma } from "@forgespecs/db";
import { dbmlToSql, type SqlDialect } from "@forgespecs/core/graph/export";
import { readableDocumentIds } from "@forgespecs/core/search";

import { currentUserId } from "@/lib/data/workspaces";

import "@/lib/auth/rbac"; // installs the RBAC provider on import

/**
 * Generate SQL DDL from a DBML string for the ERD designer's "Export SQL"
 * action. RBAC: the caller must be able to read the source document (the DBML
 * came from its content); we re-check rather than trusting the client. SQL
 * generation delegates to @dbml/core via the core export subpath.
 */
export async function exportErdSql(args: {
  documentId: string;
  dbml: string;
  dialect?: SqlDialect;
}): Promise<{ sql: string }> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Unauthorized");

  const allowed = new Set(await readableDocumentIds(prisma, { userId }));
  if (!allowed.has(args.documentId)) throw new Error("Not found");

  return { sql: dbmlToSql(args.dbml, args.dialect ?? "postgres") };
}
