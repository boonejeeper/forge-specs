/**
 * Pure transforms turning Dependency rows (+ Document metadata) into a
 * renderable graph model: typed nodes (one per document, carrying its DocType)
 * and typed edges (one per Dependency, carrying its DependencyKind).
 *
 * These are dependency-free and process-agnostic so they unit-test cleanly and
 * are shared by the per-project dependency graph (React Flow), the per-spec
 * neighborhood (1–2 hops via the crossref closure), and the workspace-wide
 * knowledge graph (Sigma). Layout (dagre/elk/forceatlas2) and rendering live in
 * the web client; this module only produces the abstract graph.
 *
 * RBAC: callers build these from rows already filtered to the reader's
 * allow-list (the data fns intersect with `readableDocumentIds`). The transform
 * itself trusts its inputs.
 */

/** The document kinds we render as node cards. Mirrors Prisma `DocumentType`. */
export type GraphDocType =
  | "VISION"
  | "PRD"
  | "RFC"
  | "ADR"
  | "API_SPEC"
  | "DB_SCHEMA"
  | "WORKFLOW"
  | "RUNBOOK"
  | "TASK_PLAN";

/** Dependency relationship kinds. Mirrors Prisma `DependencyKind`. */
export type GraphEdgeKind =
  | "IMPLEMENTS"
  | "REFERENCES"
  | "DERIVES_FROM"
  | "SUPERSEDES"
  | "BLOCKS";

/** A document as the graph needs it (the data fn selects exactly these). */
export interface GraphDocumentInput {
  id: string;
  title: string;
  type: GraphDocType;
  status: string;
  slug: string;
}

/** A dependency edge row (from→to + kind). */
export interface GraphDependencyInput {
  fromDocId: string;
  toDocId: string;
  kind: GraphEdgeKind;
}

export interface GraphNode {
  id: string;
  title: string;
  type: GraphDocType;
  status: string;
  slug: string;
  /** In-degree + out-degree, useful for sizing nodes in the knowledge graph. */
  degree: number;
  /**
   * Hop distance from the seed document for neighborhood views (0 = the seed).
   * Undefined for full-project / workspace graphs that have no single seed.
   */
  depth?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Stable edge id so React Flow / Sigma can key + dedupe parallel edges. */
export function edgeId(e: GraphDependencyInput): string {
  return `${e.fromDocId}__${e.kind}__${e.toDocId}`;
}

/**
 * Build a graph from documents + dependency rows. Edges whose endpoints are not
 * both present in `documents` are dropped (an endpoint the reader can't see, or
 * a dangling row), so the rendered graph is always internally consistent.
 * Duplicate edges (same from/to/kind) collapse to one.
 */
export function buildGraphModel(
  documents: readonly GraphDocumentInput[],
  dependencies: readonly GraphDependencyInput[],
): GraphModel {
  const byId = new Map<string, GraphDocumentInput>();
  for (const d of documents) byId.set(d.id, d);

  const degree = new Map<string, number>();
  const seenEdge = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const dep of dependencies) {
    if (!byId.has(dep.fromDocId) || !byId.has(dep.toDocId)) continue;
    if (dep.fromDocId === dep.toDocId) continue; // no self-loops
    const id = edgeId(dep);
    if (seenEdge.has(id)) continue;
    seenEdge.add(id);
    edges.push({
      id,
      source: dep.fromDocId,
      target: dep.toDocId,
      kind: dep.kind,
    });
    degree.set(dep.fromDocId, (degree.get(dep.fromDocId) ?? 0) + 1);
    degree.set(dep.toDocId, (degree.get(dep.toDocId) ?? 0) + 1);
  }

  const nodes: GraphNode[] = documents.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type,
    status: d.status,
    slug: d.slug,
    degree: degree.get(d.id) ?? 0,
  }));

  return { nodes, edges };
}

/**
 * Build a neighborhood graph centered on `seedId`. Given the crossref closure
 * edges (both directions) and a metadata lookup, keep only nodes within
 * `maxDepth` hops and annotate each node with its shortest hop distance. The
 * seed is depth 0.
 *
 * `closureEdges` are the raw recursive-CTE rows (fromDocId/toDocId/kind/depth);
 * `documents` provides titles/types for every reachable id (already RBAC-filtered
 * by the caller — unreadable ids are simply absent and their edges drop out).
 */
export function buildNeighborhoodModel(params: {
  seedId: string;
  documents: readonly GraphDocumentInput[];
  outgoing: readonly { fromDocId: string; toDocId: string; kind: GraphEdgeKind; depth: number }[];
  incoming: readonly { fromDocId: string; toDocId: string; kind: GraphEdgeKind; depth: number }[];
  maxDepth?: number;
}): GraphModel {
  const { seedId, documents, outgoing, incoming, maxDepth = 2 } = params;
  const byId = new Map<string, GraphDocumentInput>();
  for (const d of documents) byId.set(d.id, d);

  // Shortest hop distance to each reachable doc across both directions.
  const depthOf = new Map<string, number>();
  depthOf.set(seedId, 0);
  const note = (id: string, depth: number) => {
    const prev = depthOf.get(id);
    if (prev === undefined || depth < prev) depthOf.set(id, depth);
  };
  for (const e of outgoing) {
    if (e.depth <= maxDepth) note(e.toDocId, e.depth);
  }
  for (const e of incoming) {
    if (e.depth <= maxDepth) note(e.fromDocId, e.depth);
  }

  const within = (id: string) =>
    byId.has(id) && (depthOf.get(id) ?? Infinity) <= maxDepth;

  const allDeps: GraphDependencyInput[] = [...outgoing, ...incoming]
    .filter((e) => e.depth <= maxDepth && within(e.fromDocId) && within(e.toDocId))
    .map((e) => ({ fromDocId: e.fromDocId, toDocId: e.toDocId, kind: e.kind }));

  const keptDocs = documents.filter((d) => within(d.id));
  const model = buildGraphModel(keptDocs, allDeps);

  // Stamp depth onto each kept node.
  for (const node of model.nodes) {
    node.depth = depthOf.get(node.id) ?? 0;
  }
  return model;
}
