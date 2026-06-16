import "server-only";

import { prisma, type DocumentType, type Prisma } from "@forgespecs/db";
import {
  buildMaterializationPlan,
  reduceJobState,
  initialJobState,
  documentIdForRef,
  type GeneratedPlanInput,
  type GenerationJobState,
  type GenerationJobEvent,
  type Scope,
} from "@forgespecs/core";

import {
  createDocument,
  saveDocumentContent,
  createDependency,
} from "@/lib/actions/documents";

/**
 * Materialize a generated architecture into Documents + content + Dependency
 * edges — going ONLY through the human mutation paths (createDocument /
 * saveDocumentContent / createDependency), so audit, RBAC, and the Block/search
 * projection are identical to a human authoring the same docs. The AI never
 * writes Postgres-of-record directly.
 *
 * IDEMPOTENT + RESUMABLE (plan risk #2): progress is persisted on the
 * GenerationJob.progress JSON column after every step (the core job-state
 * reducer is the crash-safe core). A re-run/resume loads the last state, skips
 * refs already `done`, and resolves child parents + edge endpoints from the
 * recorded documentIds. Keyed on (jobId, docRef).
 *
 * Run from the resumable BullMQ job (inline fallback when Redis is absent) and
 * from the stream route after the wizard generates the tree.
 */

export interface MaterializeParams {
  jobId: string;
  scope: Scope; // project scope (RBAC for the create/save/dep actions)
  plan: GeneratedPlanInput;
  /** Optional callback for live UI updates (the stream route forwards these). */
  onEvent?: (state: GenerationJobState, event: GenerationJobEvent) => void;
}

/** Load the persisted state for a job (or the initial state). */
export async function loadJobState(jobId: string): Promise<GenerationJobState> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    select: { progress: true },
  });
  const raw = job?.progress;
  if (raw && typeof raw === "object" && "status" in (raw as object)) {
    return raw as unknown as GenerationJobState;
  }
  return initialJobState();
}

/** Persist a state snapshot + mirror the top-level status onto the job row. */
async function persist(jobId: string, state: GenerationJobState): Promise<void> {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      progress: state as unknown as Prisma.InputJsonValue,
      status:
        state.status === "completed"
          ? "COMPLETED"
          : state.status === "failed"
            ? "FAILED"
            : state.status === "canceled"
              ? "CANCELED"
              : "RUNNING",
      error: state.error ?? null,
    },
  });
}

/**
 * Execute (or resume) materialization of the plan for `jobId`. Returns the final
 * persisted state. Safe to call repeatedly — completed refs/edges are skipped.
 */
export async function materializeArchitecture(
  params: MaterializeParams,
): Promise<GenerationJobState> {
  const { jobId, scope, plan } = params;
  const built = buildMaterializationPlan(plan);

  let state = await loadJobState(jobId);

  const apply = async (event: GenerationJobEvent): Promise<void> => {
    state = reduceJobState(state, event);
    await persist(jobId, state);
    params.onEvent?.(state, event);
  };

  await apply({ type: "started" });
  await apply({
    type: "plan",
    refs: built.documents.map((d) => ({
      docRef: d.docRef,
      title: d.title,
      type: d.type,
    })),
  });

  // ── documents (parent-before-child order from the plan) ──────────────────
  for (const op of built.documents) {
    // Resume: skip refs already materialized.
    if (documentIdForRef(state, op.docRef)) continue;
    await apply({ type: "doc_started", docRef: op.docRef });
    try {
      if (scope.kind !== "project") {
        throw new Error("Materialization requires a project scope.");
      }
      const doc = await createDocument({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        type: op.type as DocumentType,
        title: op.title,
      });
      if (op.blocks.length > 0) {
        await saveDocumentContent({
          documentId: doc.id,
          contentJSON: op.blocks,
          scope,
        });
      }
      await apply({ type: "doc_done", docRef: op.docRef, documentId: doc.id });
    } catch (err) {
      await apply({
        type: "doc_error",
        docRef: op.docRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── dependency edges (both endpoints must be materialized) ────────────────
  for (const edge of built.edges) {
    const key = `${edge.fromRef}→${edge.toRef}:${edge.kind}`;
    if (state.edgesDone.includes(key)) continue;
    const fromId = documentIdForRef(state, edge.fromRef);
    const toId = documentIdForRef(state, edge.toRef);
    if (!fromId || !toId) continue; // an endpoint failed — skip its edges
    try {
      await createDependency({
        fromDocId: fromId,
        toDocId: toId,
        kind: edge.kind,
        scope,
      });
      await apply({ type: "edge_done", key });
    } catch {
      // Edge creation is best-effort; a missing dep must not fail the whole job.
    }
  }

  const hadError = state.docs.some((d) => d.status === "error");
  await apply(
    hadError
      ? { type: "failed", error: "Some documents failed to generate." }
      : { type: "completed" },
  );

  return state;
}
