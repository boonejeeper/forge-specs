import { describe, expect, it } from "vitest";

import {
  buildMaterializationPlan,
  materializationKey,
} from "./materialize-plan";

describe("buildMaterializationPlan", () => {
  it("emits parents before children (topological over parentRef)", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "prd", parentRef: "vision", type: "PRD", title: "PRD" },
        { ref: "vision", parentRef: null, type: "VISION", title: "Vision" },
        { ref: "rfc", parentRef: "prd", type: "RFC", title: "RFC" },
      ],
    });
    const order = plan.documents.map((d) => d.docRef);
    expect(order.indexOf("vision")).toBeLessThan(order.indexOf("prd"));
    expect(order.indexOf("prd")).toBeLessThan(order.indexOf("rfc"));
  });

  it("assigns sequential order indices", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "a", parentRef: null, type: "VISION", title: "A" },
        { ref: "b", parentRef: null, type: "PRD", title: "B" },
      ],
    });
    expect(plan.documents.map((d) => d.order)).toEqual([0, 1]);
  });

  it("collapses duplicate refs to the first occurrence", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "x", parentRef: null, type: "VISION", title: "First" },
        { ref: "x", parentRef: null, type: "PRD", title: "Second" },
      ],
    });
    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0]!.title).toBe("First");
  });

  it("drops invalid types and empty titles", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "good", parentRef: null, type: "RFC", title: "Good" },
        // @ts-expect-error invalid type on purpose
        { ref: "bad", parentRef: null, type: "NOPE", title: "Bad" },
        { ref: "blank", parentRef: null, type: "RFC", title: "  " },
      ],
    });
    expect(plan.documents.map((d) => d.docRef)).toEqual(["good"]);
  });

  it("treats unknown/self parentRef as a root", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "orphan", parentRef: "ghost", type: "RFC", title: "Orphan" },
        { ref: "self", parentRef: "self", type: "ADR", title: "Self" },
      ],
    });
    const byRef = new Map(plan.documents.map((d) => [d.docRef, d]));
    expect(byRef.get("orphan")!.parentRef).toBeNull();
    expect(byRef.get("self")!.parentRef).toBeNull();
  });

  it("is cycle-safe (does not infinite-loop on a parent cycle)", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "a", parentRef: "b", type: "RFC", title: "A" },
        { ref: "b", parentRef: "a", type: "RFC", title: "B" },
      ],
    });
    expect(plan.documents).toHaveLength(2);
  });

  it("filters edges that reference unknown refs or self-loops", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "a", parentRef: null, type: "VISION", title: "A" },
        { ref: "b", parentRef: null, type: "PRD", title: "B" },
      ],
      edges: [
        { fromRef: "b", toRef: "a", kind: "DERIVES_FROM" },
        { fromRef: "b", toRef: "ghost", kind: "REFERENCES" },
        { fromRef: "a", toRef: "a", kind: "REFERENCES" },
      ],
    });
    expect(plan.edges).toEqual([
      { fromRef: "b", toRef: "a", kind: "DERIVES_FROM" },
    ]);
  });

  it("de-dups identical edges", () => {
    const plan = buildMaterializationPlan({
      nodes: [
        { ref: "a", parentRef: null, type: "VISION", title: "A" },
        { ref: "b", parentRef: null, type: "PRD", title: "B" },
      ],
      edges: [
        { fromRef: "b", toRef: "a", kind: "DERIVES_FROM" },
        { fromRef: "b", toRef: "a", kind: "DERIVES_FROM" },
      ],
    });
    expect(plan.edges).toHaveLength(1);
  });

  it("preserves blocks on the op", () => {
    const blocks = [{ type: "paragraph", content: [] }];
    const plan = buildMaterializationPlan({
      nodes: [{ ref: "a", parentRef: null, type: "RFC", title: "A", blocks }],
    });
    expect(plan.documents[0]!.blocks).toBe(blocks);
  });
});

describe("materializationKey", () => {
  it("is stable for a (jobId, docRef) pair", () => {
    expect(materializationKey("job1", "vision")).toBe("job1::vision");
    expect(materializationKey("job1", "vision")).toBe(
      materializationKey("job1", "vision"),
    );
    expect(materializationKey("job2", "vision")).not.toBe(
      materializationKey("job1", "vision"),
    );
  });
});
