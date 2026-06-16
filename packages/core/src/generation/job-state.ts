/**
 * PURE state reducer for the generate-architecture resumable job.
 *
 * The job persists its progress as JSON (which docRefs are done, and the id of
 * the document each ref materialized into) so a refresh/disconnect/crash can
 * resume without duplicating work. Risk #2 in the plan: multi-minute, multi-call,
 * must be resumable + idempotent. The reducer is the crash-safe core: given the
 * current state and an event, produce the next state. The job runner persists
 * the result after each step; on restart it loads the last persisted state and
 * continues.
 *
 * Pure + unit-tested. No Prisma, no provider.
 */

export type GenerationJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

/** Progress for a single doc-tree node, keyed by its generator ref. */
export interface JobDocProgress {
  docRef: string;
  /** The created Document id once materialized (idempotency anchor). */
  documentId?: string;
  status: "pending" | "done" | "error";
  title?: string;
  type?: string;
  error?: string;
}

export interface GenerationJobState {
  status: GenerationJobStatus;
  /** Total nodes the plan expects (0 until the tree is generated). */
  totalDocs: number;
  /** Per-ref progress, insertion-ordered for stable UI. */
  docs: JobDocProgress[];
  /** Created edge keys ("from→to:kind") so re-runs don't re-create. */
  edgesDone: string[];
  /** Top-level error message when status=failed. */
  error?: string;
}

export type GenerationJobEvent =
  | { type: "started" }
  | { type: "plan"; refs: { docRef: string; title: string; type: string }[] }
  | { type: "doc_started"; docRef: string }
  | { type: "doc_done"; docRef: string; documentId: string }
  | { type: "doc_error"; docRef: string; error: string }
  | { type: "edge_done"; key: string }
  | { type: "completed" }
  | { type: "failed"; error: string }
  | { type: "canceled" };

/** The initial state for a freshly enqueued job. */
export function initialJobState(): GenerationJobState {
  return {
    status: "pending",
    totalDocs: 0,
    docs: [],
    edgesDone: [],
  };
}

function upsertDoc(
  docs: JobDocProgress[],
  docRef: string,
  patch: Partial<JobDocProgress>,
): JobDocProgress[] {
  const idx = docs.findIndex((d) => d.docRef === docRef);
  if (idx === -1) {
    return [...docs, { docRef, status: "pending", ...patch }];
  }
  const next = docs.slice();
  next[idx] = { ...next[idx]!, ...patch };
  return next;
}

/**
 * Reduce one event onto the state. Idempotent for the resume-critical events:
 * applying `doc_done` for an already-done ref is a no-op (same result), and
 * `plan` merges with existing progress rather than wiping it — so re-deriving
 * the plan on resume preserves completed docs.
 */
export function reduceJobState(
  state: GenerationJobState,
  event: GenerationJobEvent,
): GenerationJobState {
  switch (event.type) {
    case "started":
      return { ...state, status: "running" };

    case "plan": {
      // Merge: keep any existing progress for known refs, add new refs as pending.
      let docs = state.docs;
      for (const r of event.refs) {
        const existing = docs.find((d) => d.docRef === r.docRef);
        if (existing) {
          docs = upsertDoc(docs, r.docRef, { title: r.title, type: r.type });
        } else {
          docs = [
            ...docs,
            { docRef: r.docRef, status: "pending", title: r.title, type: r.type },
          ];
        }
      }
      return { ...state, status: "running", totalDocs: event.refs.length, docs };
    }

    case "doc_started":
      return { ...state, docs: upsertDoc(state.docs, event.docRef, {}) };

    case "doc_done": {
      const existing = state.docs.find((d) => d.docRef === event.docRef);
      if (existing && existing.status === "done") return state; // idempotent
      return {
        ...state,
        docs: upsertDoc(state.docs, event.docRef, {
          status: "done",
          documentId: event.documentId,
          error: undefined,
        }),
      };
    }

    case "doc_error":
      return {
        ...state,
        docs: upsertDoc(state.docs, event.docRef, {
          status: "error",
          error: event.error,
        }),
      };

    case "edge_done":
      return state.edgesDone.includes(event.key)
        ? state
        : { ...state, edgesDone: [...state.edgesDone, event.key] };

    case "completed":
      return { ...state, status: "completed" };

    case "failed":
      return { ...state, status: "failed", error: event.error };

    case "canceled":
      return { ...state, status: "canceled" };

    default:
      return state;
  }
}

/** Refs not yet materialized — what a resume must (re-)attempt. */
export function pendingDocRefs(state: GenerationJobState): string[] {
  return state.docs.filter((d) => d.status !== "done").map((d) => d.docRef);
}

/** Is a given ref already materialized (skip on resume)? */
export function isDocDone(state: GenerationJobState, docRef: string): boolean {
  return state.docs.some((d) => d.docRef === docRef && d.status === "done");
}

/** The created document id for a ref, if materialized (parent-link resolution). */
export function documentIdForRef(
  state: GenerationJobState,
  docRef: string,
): string | undefined {
  return state.docs.find((d) => d.docRef === docRef)?.documentId;
}

/** Convenience: progress fraction 0..1 for the UI. */
export function jobProgress(state: GenerationJobState): number {
  if (state.totalDocs === 0) return 0;
  const done = state.docs.filter((d) => d.status === "done").length;
  return Math.min(1, done / state.totalDocs);
}
