import "server-only";

import { prisma } from "@forgespecs/db";
import {
  buildGraphModel,
  buildNeighborhoodModel,
  type GraphModel,
  type GraphDocumentInput,
  type GraphDependencyInput,
  type GraphEdgeKind,
} from "@forgespecs/core/graph";
import {
  readableDocumentIds,
  dependencyClosure,
} from "@forgespecs/core/search";

import { currentUserId } from "@/lib/data/workspaces";

/**
 * Server data functions that turn Dependency rows (+ Document metadata) into the
 * renderable graph model the visual surfaces consume. ALL of these are
 * RBAC-scoped: documents are restricted to the reader's allow-list
 * (`readableDocumentIds`) and edges to pairs of readable docs (the pure
 * `buildGraphModel` drops any edge whose endpoint isn't present).
 *
 *  - getProjectGraph     → the per-project dependency DAG (React Flow).
 *  - getWorkspaceGraph   → the workspace-wide knowledge graph (Sigma).
 *  - getNeighborhoodGraph→ 1–2 hop neighborhood of one spec (crossref closure).
 */

function toDocInputs(
  rows: { id: string; title: string; type: string; status: string; slug: string }[],
): GraphDocumentInput[] {
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type as GraphDocumentInput["type"],
    status: d.status,
    slug: d.slug,
  }));
}

async function documentsForIds(ids: string[]): Promise<GraphDocumentInput[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, type: true, status: true, slug: true },
  });
  return toDocInputs(rows);
}

async function dependenciesAmong(ids: string[]): Promise<GraphDependencyInput[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.dependency.findMany({
    where: { fromDocId: { in: ids }, toDocId: { in: ids } },
    select: { fromDocId: true, toDocId: true, kind: true },
  });
  return rows.map((r) => ({
    fromDocId: r.fromDocId,
    toDocId: r.toDocId,
    kind: r.kind as GraphEdgeKind,
  }));
}

/** Per-project dependency graph. Empty when the user can't read the project. */
export async function getProjectGraph(
  workspaceId: string,
  projectId: string,
): Promise<GraphModel> {
  const userId = await currentUserId();
  if (!userId) return { nodes: [], edges: [] };

  const ids = await readableDocumentIds(prisma, { userId, workspaceId, projectId });
  const [docs, deps] = await Promise.all([
    documentsForIds(ids),
    dependenciesAmong(ids),
  ]);
  return buildGraphModel(docs, deps);
}

/** Workspace-wide knowledge graph (every readable doc across projects). */
export async function getWorkspaceGraph(
  workspaceId: string,
): Promise<GraphModel> {
  const userId = await currentUserId();
  if (!userId) return { nodes: [], edges: [] };

  const ids = await readableDocumentIds(prisma, { userId, workspaceId });
  const [docs, deps] = await Promise.all([
    documentsForIds(ids),
    dependenciesAmong(ids),
  ]);
  return buildGraphModel(docs, deps);
}

/**
 * 1–2 hop neighborhood of a single spec, built from the recursive-CTE crossref
 * closure (both directions). RBAC: the seed must be readable and the closure is
 * intersected with the reader's allow-list (deps can cross projects).
 */
export async function getNeighborhoodGraph(
  documentId: string,
  maxDepth = 2,
): Promise<GraphModel> {
  const userId = await currentUserId();
  if (!userId) return { nodes: [], edges: [] };

  const allowed = new Set(await readableDocumentIds(prisma, { userId }));
  if (!allowed.has(documentId)) return { nodes: [], edges: [] };

  const [outgoing, incoming] = await Promise.all([
    dependencyClosure(prisma, { documentId, direction: "outgoing", maxDepth }),
    dependencyClosure(prisma, { documentId, direction: "incoming", maxDepth }),
  ]);

  const reachable = new Set<string>([documentId]);
  for (const e of [...outgoing, ...incoming]) {
    if (allowed.has(e.fromDocId)) reachable.add(e.fromDocId);
    if (allowed.has(e.toDocId)) reachable.add(e.toDocId);
  }

  const docs = await documentsForIds(
    [...reachable].filter((id) => allowed.has(id)),
  );

  const cast = (
    edges: { fromDocId: string; toDocId: string; kind: string; depth: number }[],
  ) =>
    edges.map((e) => ({
      fromDocId: e.fromDocId,
      toDocId: e.toDocId,
      kind: e.kind as GraphEdgeKind,
      depth: e.depth,
    }));

  return buildNeighborhoodModel({
    seedId: documentId,
    documents: docs,
    outgoing: cast(outgoing),
    incoming: cast(incoming),
    maxDepth,
  });
}
