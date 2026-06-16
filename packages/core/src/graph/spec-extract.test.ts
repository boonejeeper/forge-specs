import { describe, it, expect } from "vitest";

import { extractOpenApiSpec, extractErdSource } from "./spec-extract";

const openapiYaml = `openapi: 3.1.0
info:
  title: Orders API
  version: 1.0.0
paths:
  /orders:
    get:
      summary: List orders
`;

describe("extractOpenApiSpec", () => {
  it("parses an OpenAPI yaml code block from an API_SPEC doc", () => {
    const doc = [
      { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Orders API" }] },
      { type: "paragraph", content: [{ type: "text", text: "The contract:" }] },
      { type: "code", props: { code: openapiYaml, language: "yaml" } },
    ];
    const result = extractOpenApiSpec(doc);
    expect(result).not.toBeNull();
    expect(result!.format).toBe("yaml");
    expect((result!.spec as { openapi: string }).openapi).toBe("3.1.0");
    expect(result!.source).toContain("/orders");
  });

  it("parses a JSON OpenAPI block", () => {
    const spec = { openapi: "3.1.0", info: { title: "X", version: "1" }, paths: {} };
    const doc = [
      { type: "code", props: { code: JSON.stringify(spec), language: "json" } },
    ];
    const result = extractOpenApiSpec(doc);
    expect(result!.format).toBe("json");
    expect((result!.spec as { info: { title: string } }).info.title).toBe("X");
  });

  it("prefers the openapi-shaped block over unrelated code", () => {
    const doc = [
      { type: "code", props: { code: "SELECT 1;", language: "sql" } },
      { type: "code", props: { code: openapiYaml, language: "yaml" } },
    ];
    const result = extractOpenApiSpec(doc);
    expect((result!.spec as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("returns null when there is no OpenAPI content", () => {
    const doc = [{ type: "code", props: { code: "console.log(1)", language: "ts" } }];
    expect(extractOpenApiSpec(doc)).toBeNull();
    expect(extractOpenApiSpec(null)).toBeNull();
    expect(extractOpenApiSpec([])).toBeNull();
  });
});

describe("extractErdSource", () => {
  it("extracts a Mermaid erDiagram block (the M7 seed)", () => {
    const mermaid = `erDiagram\n  USER ||--o{ ORDER : places\n  USER {\n    int id PK\n  }`;
    const doc = [
      { type: "heading", content: [{ type: "text", text: "Schema" }] },
      { type: "mermaid", props: { code: mermaid } },
    ];
    const result = extractErdSource(doc);
    expect(result).not.toBeNull();
    expect(result!.format).toBe("mermaid");
    expect(result!.source).toContain("erDiagram");
  });

  it("prefers a DBML code block over Mermaid when both exist", () => {
    const doc = [
      { type: "mermaid", props: { code: "erDiagram\n A ||--o{ B : x" } },
      { type: "code", props: { code: "Table a {\n id int [pk]\n}", language: "dbml" } },
    ];
    const result = extractErdSource(doc);
    expect(result!.format).toBe("dbml");
  });

  it("ignores non-erDiagram mermaid blocks", () => {
    const doc = [{ type: "mermaid", props: { code: "graph TD; A-->B" } }];
    expect(extractErdSource(doc)).toBeNull();
  });
});
