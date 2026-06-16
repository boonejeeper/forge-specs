import { describe, it, expect } from "vitest";

import {
  buildGraphModel,
  buildNeighborhoodModel,
  edgeId,
  type GraphDocumentInput,
  type GraphDependencyInput,
} from "./graph-model";

const docs: GraphDocumentInput[] = [
  { id: "v", title: "Vision", type: "VISION", status: "APPROVED", slug: "vision" },
  { id: "r1", title: "RFC 1", type: "RFC", status: "DRAFT", slug: "rfc-1" },
  { id: "r2", title: "RFC 2", type: "RFC", status: "DRAFT", slug: "rfc-2" },
  { id: "db", title: "Schema", type: "DB_SCHEMA", status: "DRAFT", slug: "schema" },
];

const deps: GraphDependencyInput[] = [
  { fromDocId: "r1", toDocId: "v", kind: "DERIVES_FROM" },
  { fromDocId: "r2", toDocId: "v", kind: "DERIVES_FROM" },
  { fromDocId: "db", toDocId: "r1", kind: "IMPLEMENTS" },
];

describe("buildGraphModel", () => {
  it("produces one node per document with degree", () => {
    const g = buildGraphModel(docs, deps);
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(3);
    const v = g.nodes.find((n) => n.id === "v")!;
    expect(v.degree).toBe(2); // two RFCs point at it
    const r1 = g.nodes.find((n) => n.id === "r1")!;
    expect(r1.degree).toBe(2); // derives v, implemented by db
  });

  it("drops edges with a missing endpoint (RBAC-filtered docs)", () => {
    const visible = docs.filter((d) => d.id !== "v"); // viewer can't see Vision
    const g = buildGraphModel(visible, deps);
    // Both DERIVES_FROM edges target the hidden Vision → dropped.
    expect(g.edges.map((e) => e.id)).toEqual([edgeId(deps[2]!)]);
  });

  it("dedupes parallel edges and ignores self-loops", () => {
    const g = buildGraphModel(docs, [
      ...deps,
      { fromDocId: "r1", toDocId: "v", kind: "DERIVES_FROM" }, // dup
      { fromDocId: "r1", toDocId: "r1", kind: "REFERENCES" }, // self
    ]);
    expect(g.edges).toHaveLength(3);
  });

  it("carries DocType and DependencyKind through", () => {
    const g = buildGraphModel(docs, deps);
    expect(g.nodes.find((n) => n.id === "db")!.type).toBe("DB_SCHEMA");
    expect(g.edges.find((e) => e.source === "db")!.kind).toBe("IMPLEMENTS");
  });
});

describe("buildNeighborhoodModel", () => {
  it("keeps nodes within maxDepth and stamps shortest depth", () => {
    const g = buildNeighborhoodModel({
      seedId: "v",
      documents: docs,
      // incoming: who points at v → r1,r2 (depth1), db→r1 (depth2)
      incoming: [
        { fromDocId: "r1", toDocId: "v", kind: "DERIVES_FROM", depth: 1 },
        { fromDocId: "r2", toDocId: "v", kind: "DERIVES_FROM", depth: 1 },
        { fromDocId: "db", toDocId: "r1", kind: "IMPLEMENTS", depth: 2 },
      ],
      outgoing: [],
      maxDepth: 2,
    });
    expect(g.nodes.find((n) => n.id === "v")!.depth).toBe(0);
    expect(g.nodes.find((n) => n.id === "r1")!.depth).toBe(1);
    expect(g.nodes.find((n) => n.id === "db")!.depth).toBe(2);
    expect(g.nodes).toHaveLength(4);
  });

  it("excludes nodes beyond maxDepth", () => {
    const g = buildNeighborhoodModel({
      seedId: "v",
      documents: docs,
      incoming: [
        { fromDocId: "r1", toDocId: "v", kind: "DERIVES_FROM", depth: 1 },
        { fromDocId: "db", toDocId: "r1", kind: "IMPLEMENTS", depth: 2 },
      ],
      outgoing: [],
      maxDepth: 1,
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["r1", "v"]);
    expect(g.edges).toHaveLength(1);
  });
});
