import { serializeBundle, resolveFormat } from "@forgespecs/core/export";

import { getAgentView } from "@/lib/data/agents";
import { getBundleExportData } from "@/lib/data/export";

/**
 * GET /api/agents/[agentName]/export?workspaceId=...
 *
 * The export bundle for an AI agent's assigned work — exactly what an autonomous
 * coding agent consumes: the documents that mention the agent, plus their
 * dependency closure, each with frontmatter, acceptance criteria, and extracted
 * OpenAPI / DBML+SQL. Content-negotiated MD / JSON / YAML.
 *
 * RBAC: doc.read — getAgentView and getBundleExportData both scope to the
 * reader's allow-list; an agent with no readable assigned docs 404s.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ agentName: string }> },
): Promise<Response> {
  const { agentName: rawName } = await ctx.params;
  const agentName = decodeURIComponent(rawName);
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");

  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const view = await getAgentView(workspaceId, agentName);
  if (!view) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const docs = await getBundleExportData(view.assignedDocumentIds);
  if (docs === null) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const format = resolveFormat({
    formatParam: url.searchParams.get("format"),
    accept: request.headers.get("accept"),
  });

  const result = serializeBundle(
    format,
    {
      title: `Agent work: ${agentName}`,
      description: `Assigned specs + dependency closure for agent "${agentName}".`,
      generatedAt: new Date().toISOString(),
    },
    docs,
  );

  const safeName = agentName.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `inline; filename="agent-${safeName}.${result.extension}"`,
      "Cache-Control": "no-store",
    },
  });
}
