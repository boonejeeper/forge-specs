import { describe, expect, it } from "vitest";

import {
  initialJobState,
  reduceJobState,
  pendingDocRefs,
  isDocDone,
  documentIdForRef,
  jobProgress,
  type GenerationJobState,
} from "./job-state";

const plan = (s: GenerationJobState): GenerationJobState =>
  reduceJobState(s, {
    type: "plan",
    refs: [
      { docRef: "vision", title: "Vision", type: "VISION" },
      { docRef: "prd", title: "PRD", type: "PRD" },
    ],
  });

describe("reduceJobState", () => {
  it("starts pending and transitions to running", () => {
    const s = initialJobState();
    expect(s.status).toBe("pending");
    expect(reduceJobState(s, { type: "started" }).status).toBe("running");
  });

  it("plan sets totalDocs + pending docs", () => {
    const s = plan(initialJobState());
    expect(s.totalDocs).toBe(2);
    expect(s.docs.map((d) => d.docRef)).toEqual(["vision", "prd"]);
    expect(s.docs.every((d) => d.status === "pending")).toBe(true);
  });

  it("doc_done records the documentId and is idempotent", () => {
    let s = plan(initialJobState());
    s = reduceJobState(s, { type: "doc_done", docRef: "vision", documentId: "doc_v" });
    expect(documentIdForRef(s, "vision")).toBe("doc_v");
    expect(isDocDone(s, "vision")).toBe(true);
    // Re-applying must not change state (resume safety).
    const again = reduceJobState(s, {
      type: "doc_done",
      docRef: "vision",
      documentId: "doc_v",
    });
    expect(again).toBe(s);
  });

  it("plan merges with existing progress on resume (does not wipe done docs)", () => {
    let s = plan(initialJobState());
    s = reduceJobState(s, { type: "doc_done", docRef: "vision", documentId: "doc_v" });
    // Resume re-derives the plan; the done doc must survive.
    s = plan(s);
    expect(isDocDone(s, "vision")).toBe(true);
    expect(documentIdForRef(s, "vision")).toBe("doc_v");
  });

  it("doc_error marks the ref errored", () => {
    let s = plan(initialJobState());
    s = reduceJobState(s, { type: "doc_error", docRef: "prd", error: "boom" });
    const prd = s.docs.find((d) => d.docRef === "prd");
    expect(prd?.status).toBe("error");
    expect(prd?.error).toBe("boom");
  });

  it("edge_done de-dups edge keys", () => {
    let s = initialJobState();
    s = reduceJobState(s, { type: "edge_done", key: "prd→vision:DERIVES_FROM" });
    s = reduceJobState(s, { type: "edge_done", key: "prd→vision:DERIVES_FROM" });
    expect(s.edgesDone).toHaveLength(1);
  });

  it("completed / failed / canceled set status", () => {
    expect(reduceJobState(initialJobState(), { type: "completed" }).status).toBe(
      "completed",
    );
    const failed = reduceJobState(initialJobState(), { type: "failed", error: "x" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("x");
    expect(reduceJobState(initialJobState(), { type: "canceled" }).status).toBe(
      "canceled",
    );
  });
});

describe("pendingDocRefs / jobProgress", () => {
  it("pendingDocRefs returns only not-done refs", () => {
    let s = plan(initialJobState());
    s = reduceJobState(s, { type: "doc_done", docRef: "vision", documentId: "v" });
    expect(pendingDocRefs(s)).toEqual(["prd"]);
  });

  it("jobProgress is the done fraction", () => {
    let s = plan(initialJobState());
    expect(jobProgress(s)).toBe(0);
    s = reduceJobState(s, { type: "doc_done", docRef: "vision", documentId: "v" });
    expect(jobProgress(s)).toBe(0.5);
    s = reduceJobState(s, { type: "doc_done", docRef: "prd", documentId: "p" });
    expect(jobProgress(s)).toBe(1);
  });

  it("jobProgress is 0 before a plan exists", () => {
    expect(jobProgress(initialJobState())).toBe(0);
  });
});
