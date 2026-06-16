import { NextResponse } from "next/server";
import { prisma } from "@forgespecs/db";
import {
  dependencyClosure,
  reachableDocIds,
  readableDocumentIds,
} from "@forgespecs/core/search";

import { currentUserId } from "@/lib/data/workspaces";

/**
 * GET /api/documents/[documentId]/crossref
 *
 * Cross-reference / impact analysis for a document: the transitive closure of
 * its dependency graph in both directions —
 *   - outgoing: docs this one depends on / references,
 *   - incoming: docs that reference this one (the blast radius of a change).
 *
 * Computed with a recursive CTE over the Dependency table. RBAC: the seed must
 * be readable by the user, and the closure is intersected with the user's
 * readable-doc allow-list (dependencies can cross projects, so the unfiltered
 * closure is trimmed here to only the docs the caller may see).
 */

export interface CrossRefDocDto {
  documentId: string;
  title: string;
  type: string;
  status: string;
  /** Hops from the seed in the relevant direction. */
  depth: number;
  /** The dependency kind on the edge nearest the seed. */
  kind: string;
}

export interface CrossRefResponse {
  documentId: string;
  incoming: CrossRefDocDto[];
  outgoing: CrossRefDocDto[];
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const { documentId } = await ctx.params;

  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reader's allow-list. Seed must be in it (doc.read gate).
  const allowed = new Set(await readableDocumentIds(prisma, { userId }));
  if (!allowed.has(documentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [outgoingEdges, incomingEdges] = await Promise.all([
    dependencyClosure(prisma, { documentId, direction: "outgoing" }),
    dependencyClosure(prisma, { documentId, direction: "incoming" }),
  ]);

  const outIds = reachableDocIds(outgoingEdges, "outgoing").filter((id) =>
    allowed.has(id),
  );
  const inIds = reachableDocIds(incomingEdges, "incoming").filter((id) =>
    allowed.has(id),
  );

  const meta = await prisma.document.findMany({
    where: { id: { in: [...new Set([...outIds, ...inIds])] } },
    select: { id: true, title: true, type: true, status: true },
  });
  const byId = new Map(meta.map((d) => [d.id, d]));

  // Shallowest depth + its edge kind per reachable doc.
  const shallowest = (
    edges: typeof outgoingEdges,
    pick: (e: (typeof outgoingEdges)[number]) => string,
    ids: string[],
  ): CrossRefDocDto[] => {
    const best = new Map<string, { depth: number; kind: string }>();
    for (const e of edges) {
      const id = pick(e);
      const prev = best.get(id);
      if (!prev || e.depth < prev.depth) {
        best.set(id, { depth: e.depth, kind: e.kind });
      }
    }
    const out: CrossRefDocDto[] = [];
    for (const id of ids) {
      const d = byId.get(id);
      const b = best.get(id);
      if (!d || !b) continue;
      out.push({
        documentId: d.id,
        title: d.title,
        type: d.type,
        status: d.status,
        depth: b.depth,
        kind: b.kind,
      });
    }
    return out.sort((a, b) => a.depth - b.depth);
  };

  const response: CrossRefResponse = {
    documentId,
    outgoing: shallowest(outgoingEdges, (e) => e.toDocId, outIds),
    incoming: shallowest(incomingEdges, (e) => e.fromDocId, inIds),
  };
  return NextResponse.json(response);
}
