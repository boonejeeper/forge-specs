import { prisma } from "@forgespecs/db";
import { readableDocumentIds } from "@forgespecs/core/search";
import {
  serializeBundle,
  serializeDocument,
  resolveFormat,
} from "@forgespecs/core/export";

import { currentUserId } from "@/lib/data/workspaces";
import { getDocumentExportData } from "@/lib/data/export";

/**
 * GET /api/documents/[documentId]/export
 *
 * Content-negotiated export of a document PLUS its outgoing dependency closure
 * (via the crossref recursive CTE) in Markdown / JSON / YAML. Each document
 * carries its frontmatter (status/owner/version/implementation_state),
 * acceptance criteria, and — for API_SPEC / DB_SCHEMA docs — the extracted
 * OpenAPI / DBML+SQL (M9 extractors).
 *
 * Format selection (resolveFormat): explicit `?format=md|json|yaml` wins, else
 * the `Accept` header, else Markdown.
 *
 * `?closure=0` exports only the seed document (no dependency bundle).
 *
 * RBAC: doc.read — the seed must be in the reader's allow-list; the closure is
 * trimmed to readable docs (handled in getDocumentExportData).
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await ctx.params;
  const url = new URL(request.url);

  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // doc.read gate: seed must be readable.
  const allowed = new Set(await readableDocumentIds(prisma, { userId }));
  if (!allowed.has(documentId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const format = resolveFormat({
    formatParam: url.searchParams.get("format"),
    accept: request.headers.get("accept"),
  });
  const includeClosure = url.searchParams.get("closure") !== "0";

  const data = await getDocumentExportData(documentId);
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const filenameBase = `${data.seed.slug || "document"}`;

  let result: { body: string; contentType: string; extension: string };
  if (includeClosure && data.closure.length > 0) {
    result = serializeBundle(
      format,
      {
        title: data.seed.title,
        description: `Document export with dependency closure (${data.closure.length} dependencies).`,
        generatedAt: new Date().toISOString(),
      },
      [data.seed, ...data.closure],
    );
  } else {
    result = serializeDocument(format, data.seed);
  }

  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `inline; filename="${filenameBase}.${result.extension}"`,
      "Cache-Control": "no-store",
    },
  });
}
