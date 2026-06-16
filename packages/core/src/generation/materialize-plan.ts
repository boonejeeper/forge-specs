/**
 * PURE materialization mapping: a generated architecture (flat nodes + edges,
 * by ref) → an ordered plan of create-document + seed-content + create-edge
 * operations the web layer executes through the HUMAN mutation paths
 * (createDocument / saveDocumentContent / createDependency).
 *
 * Why pure + here (core): the mapping (ref → order, parentRef → tree, edges →
 * Dependency inputs) is the part worth unit-testing, and it must be identical
 * whether materialization runs from the streaming route or the resumable job.
 * Nothing in this file touches Prisma or a provider.
 *
 * IDEMPOTENCY: each node carries a stable `docRef` (the generator ref). The
 * executor keys created documents on (jobId, docRef) so re-runs/resumes skip
 * nodes already done — see the web materializer. This file only produces the
 * plan; it does not decide what's already done.
 */

/** The Prisma DocumentType values (string union — avoids importing the enum). */
export type PlanDocType =
  | "VISION"
  | "PRD"
  | "RFC"
  | "ADR"
  | "API_SPEC"
  | "DB_SCHEMA"
  | "WORKFLOW"
  | "RUNBOOK"
  | "TASK_PLAN";

export type PlanDependencyKind =
  | "IMPLEMENTS"
  | "REFERENCES"
  | "DERIVES_FROM"
  | "SUPERSEDES"
  | "BLOCKS";

/** A node from a generated architecture (the subset the plan needs). */
export interface PlanInputNode {
  ref: string;
  parentRef?: string | null;
  type: PlanDocType;
  title: string;
  summary?: string;
  /** BlockNote body (already materialized from generator blocks). */
  blocks?: unknown[];
}

export interface PlanInputEdge {
  fromRef: string;
  toRef: string;
  kind: PlanDependencyKind;
}

export interface GeneratedPlanInput {
  nodes: PlanInputNode[];
  edges?: PlanInputEdge[];
}

/** One document to create + seed, in dependency-safe order. */
export interface PlanDocumentOp {
  /** Stable idempotency ref (the generator's node ref). */
  docRef: string;
  parentRef: string | null;
  type: PlanDocType;
  title: string;
  summary: string;
  /** BlockNote body to seed via saveDocumentContent (empty array if none). */
  blocks: unknown[];
  /** 0-based position within the plan (drives frontmatter.order on create). */
  order: number;
}

/** One dependency edge to create after both endpoints exist. */
export interface PlanEdgeOp {
  fromRef: string;
  toRef: string;
  kind: PlanDependencyKind;
}

export interface MaterializationPlan {
  documents: PlanDocumentOp[];
  edges: PlanEdgeOp[];
}

const VALID_TYPES = new Set<PlanDocType>([
  "VISION",
  "PRD",
  "RFC",
  "ADR",
  "API_SPEC",
  "DB_SCHEMA",
  "WORKFLOW",
  "RUNBOOK",
  "TASK_PLAN",
]);

const VALID_KINDS = new Set<PlanDependencyKind>([
  "IMPLEMENTS",
  "REFERENCES",
  "DERIVES_FROM",
  "SUPERSEDES",
  "BLOCKS",
]);

/**
 * Build a deterministic materialization plan from a generated architecture.
 *
 * Guarantees:
 *  - Nodes are emitted in PARENT-BEFORE-CHILD order (topological over parentRef)
 *    so the executor can resolve a child's parent doc id when it runs. Cycles or
 *    dangling parentRefs degrade gracefully (treated as roots) — generation is
 *    untrusted input.
 *  - Duplicate refs collapse to the first occurrence (refs are the idempotency
 *    key; a model emitting the same ref twice must not create two docs).
 *  - Invalid types are dropped (logged by the caller if desired) rather than
 *    crashing materialization.
 *  - Edges referencing unknown/dropped refs are filtered out so we never try to
 *    create a Dependency to a non-existent document.
 */
export function buildMaterializationPlan(
  input: GeneratedPlanInput,
): MaterializationPlan {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];

  // De-dup by ref + drop invalid types/empty titles.
  const byRef = new Map<string, PlanInputNode>();
  for (const n of nodes) {
    if (!n || typeof n.ref !== "string" || n.ref.length === 0) continue;
    if (!VALID_TYPES.has(n.type)) continue;
    if (typeof n.title !== "string" || n.title.trim().length === 0) continue;
    if (!byRef.has(n.ref)) byRef.set(n.ref, n);
  }

  // Topological emit: parent before child. A node whose parentRef is unknown (or
  // null, or self) is a root. Cycle-safe via a visiting guard.
  const ordered: PlanInputNode[] = [];
  const emitted = new Set<string>();
  const visiting = new Set<string>();

  const visit = (ref: string): void => {
    if (emitted.has(ref) || visiting.has(ref)) return;
    const node = byRef.get(ref);
    if (!node) return;
    visiting.add(ref);
    const parent = node.parentRef;
    if (parent && parent !== ref && byRef.has(parent)) {
      visit(parent);
    }
    visiting.delete(ref);
    if (!emitted.has(ref)) {
      emitted.add(ref);
      ordered.push(node);
    }
  };
  // Preserve the model's overall ordering for siblings by iterating insertion order.
  for (const ref of byRef.keys()) visit(ref);

  const documents: PlanDocumentOp[] = ordered.map((n, index) => ({
    docRef: n.ref,
    parentRef:
      n.parentRef && n.parentRef !== n.ref && byRef.has(n.parentRef)
        ? n.parentRef
        : null,
    type: n.type,
    title: n.title.trim(),
    summary: typeof n.summary === "string" ? n.summary : "",
    blocks: Array.isArray(n.blocks) ? n.blocks : [],
    order: index,
  }));

  const known = new Set(documents.map((d) => d.docRef));
  const seenEdge = new Set<string>();
  const edges: PlanEdgeOp[] = [];
  for (const e of input.edges ?? []) {
    if (!e || !VALID_KINDS.has(e.kind)) continue;
    if (!known.has(e.fromRef) || !known.has(e.toRef)) continue;
    if (e.fromRef === e.toRef) continue;
    const key = `${e.fromRef}→${e.toRef}:${e.kind}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push({ fromRef: e.fromRef, toRef: e.toRef, kind: e.kind });
  }

  return { documents, edges };
}

/**
 * Deterministic idempotency key for a materialized document within a job. The
 * executor stores this (per created doc) so a resume skips already-created
 * nodes. Stable for a given (jobId, docRef).
 */
export function materializationKey(jobId: string, docRef: string): string {
  return `${jobId}::${docRef}`;
}
